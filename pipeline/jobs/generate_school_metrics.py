from __future__ import annotations

import csv
import io
import json
import math
import re
import time
import zipfile
from datetime import datetime
from pathlib import Path
from statistics import mean
from typing import Any
from urllib.parse import urljoin

import requests


ROOT = Path(__file__).resolve().parents[2]
OUTPUT_PATH = ROOT / 'data' / 'raw' / 'schools_metrics.json'
SOURCE_METADATA_PATH = ROOT / 'data' / 'raw' / 'source_metadata.json'
ANCHOR_COORDINATES_PATH = ROOT / 'data' / 'raw' / 'school_anchor_coordinates.json'

GIAS_HOME_URL = 'https://www.get-information-schools.service.gov.uk/'
GIAS_DOWNLOADS_URL = f'{GIAS_HOME_URL}Downloads'
GIAS_COLLATE_URL = f'{GIAS_HOME_URL}Downloads/Collate'
GIAS_EXTRACT_URL = f'{GIAS_HOME_URL}Downloads/Download/Extract'
GIAS_GENERATE_AJAX_PREFIX = f'{GIAS_HOME_URL}Downloads/GenerateAjax/'

PRIMARY_PERFORMANCE_URL = (
    'https://explore-education-statistics.service.gov.uk/data-catalogue/data-set/'
    'f6cb50e9-0eca-4b1e-ac1a-6f6bb9d21a07/csv'
)
SECONDARY_PERFORMANCE_URL = (
    'https://explore-education-statistics.service.gov.uk/data-catalogue/data-set/'
    'c8f753ef-b76f-41a3-8949-13382e131054/csv'
)

USER_AGENT = (
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
    'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36'
)
REQUEST_TIMEOUT_SECONDS = 120
POLL_SLEEP_SECONDS = 2
POLL_MAX_ATTEMPTS = 90

ALL_ESTABLISHMENTS_TAG = 'all.edubase.data'
STATE_FUNDED_TAG = 'all.open.state-funded.schools'

PRIMARY_RADIUS_METERS = 2250.0
SECONDARY_RADIUS_METERS = 2750.0
DISTANCE_WEIGHT_FLOOR_METERS = 250.0
MINIMUM_QUALITY_INPUTS = 3

PRIMARY_PHASES = {'Primary', 'Middle deemed primary', 'All-through'}
SECONDARY_PHASES = {'Secondary', 'Middle deemed secondary', 'All-through'}
PRIMARY_QUALITY_WEIGHTS = {
    'expected': 0.45,
    'higher': 0.15,
    'reading_progress': 0.15,
    'maths_progress': 0.15,
    'reading_scaled': 0.05,
    'maths_scaled': 0.05,
}
SECONDARY_QUALITY_WEIGHTS = {
    'p8': 0.50,
    'att8': 0.25,
    'basics4': 0.15,
    'ebacc4': 0.10,
}

INPUT_PATTERN = re.compile(r'<input[^>]+name="([^"]+)"[^>]+value="([^"]*)"', re.IGNORECASE)


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding='utf-8'))


def write_json(path: Path, payload: Any) -> None:
    path.write_text(f'{json.dumps(payload, indent=2)}\n', encoding='utf-8')


def safe_float(raw_value: str | None) -> float | None:
    if raw_value in (None, '', 'z', 'x', 'u', 'c', 'SUPP', 'NA'):
        return None
    try:
        return float(raw_value)
    except ValueError:
        return None


def percentile_rank_map(metric_values: dict[str, float | None]) -> dict[str, float]:
    import bisect

    sorted_values = sorted(value for value in metric_values.values() if value is not None)
    if not sorted_values:
        return {}

    count = len(sorted_values)
    percentile_scores: dict[str, float] = {}
    for key, value in metric_values.items():
        if value is None:
            continue

        left = bisect.bisect_left(sorted_values, value)
        right = bisect.bisect_right(sorted_values, value)
        average_rank = (left + right - 1) / 2
        percentile_scores[key] = 100.0 * average_rank / max(1, count - 1)

    return percentile_scores


def weighted_average(pairs: list[tuple[float, float]]) -> float | None:
    if not pairs:
        return None
    total_weight = sum(weight for _, weight in pairs)
    if total_weight <= 0:
        return None
    return sum(value * weight for value, weight in pairs) / total_weight


def percentile_quality_scores(
    metric_bundle_by_urn: dict[str, dict[str, float | None]],
    metric_weights: dict[str, float],
) -> dict[str, float]:
    percentile_maps = {
        metric_name: percentile_rank_map(
            {urn: values.get(metric_name) for urn, values in metric_bundle_by_urn.items()}
        )
        for metric_name in metric_weights
    }

    output: dict[str, float] = {}
    for urn in metric_bundle_by_urn:
        weighted_parts = [
            (percentile_maps[metric_name][urn], weight)
            for metric_name, weight in metric_weights.items()
            if urn in percentile_maps[metric_name]
        ]
        score = weighted_average(weighted_parts)
        if score is not None:
            output[urn] = score

    return output


def proximity_weighted_quality(
    anchor_easting: float,
    anchor_northing: float,
    school_records: dict[str, dict[str, Any]],
    quality_scores: dict[str, float],
    *,
    allowed_phases: set[str],
    radius_meters: float,
    minimum_inputs: int = MINIMUM_QUALITY_INPUTS,
) -> float | None:
    scored_candidates: list[tuple[float, float]] = []
    for urn, record in school_records.items():
        if urn not in quality_scores:
            continue
        if record['phase'] not in allowed_phases:
            continue
        distance = math.hypot(record['easting'] - anchor_easting, record['northing'] - anchor_northing)
        scored_candidates.append((distance, quality_scores[urn]))

    if not scored_candidates:
        return None

    inside_radius = [(distance, score) for distance, score in scored_candidates if distance <= radius_meters]
    inside_radius.sort(key=lambda item: item[0])

    if len(inside_radius) < minimum_inputs:
        outside_radius = [(distance, score) for distance, score in scored_candidates if distance > radius_meters]
        outside_radius.sort(key=lambda item: item[0])
        inside_radius.extend(outside_radius[: max(0, minimum_inputs - len(inside_radius))])

    weighted_parts = [
        (score, 1.0 / max(DISTANCE_WEIGHT_FLOOR_METERS, distance))
        for distance, score in inside_radius
    ]
    return weighted_average(weighted_parts)


def extract_form_html(page_html: str, action: str) -> str:
    pattern = re.compile(
        rf'<form[^>]+action="{re.escape(action)}"[^>]*>(.*?)</form>',
        re.IGNORECASE | re.DOTALL,
    )
    match = pattern.search(page_html)
    if not match:
        raise RuntimeError(f'Could not find form for action {action}')
    return match.group(1)


def parse_download_form(page_html: str) -> tuple[list[tuple[str, str]], dict[str, int], dict[int, str]]:
    form_html = extract_form_html(page_html, '/Downloads/Collate')
    payload_fields: list[tuple[str, str]] = []
    tag_indices: dict[str, int] = {}
    file_dates: dict[int, str] = {}

    for name, value in INPUT_PATTERN.findall(form_html):
        if name.endswith('.Selected'):
            continue
        payload_fields.append((name, value))

        tag_match = re.fullmatch(r'Downloads\[(\d+)\]\.Tag', name)
        if tag_match:
            tag_indices[value] = int(tag_match.group(1))
            continue

        date_match = re.fullmatch(r'Downloads\[(\d+)\]\.FileGeneratedDate', name)
        if date_match:
            file_dates[int(date_match.group(1))] = value

    return payload_fields, tag_indices, file_dates


def parse_generated_extract_form(page_html: str) -> dict[str, str]:
    form_html = extract_form_html(page_html, '/Downloads/Download/Extract')
    return {name: value for name, value in INPUT_PATTERN.findall(form_html)}


def parse_nested_json_payload(raw_text: str) -> dict[str, Any]:
    payload = json.loads(raw_text)
    return json.loads(payload) if isinstance(payload, str) else payload


def gias_session() -> requests.Session:
    session = requests.Session()
    session.headers.update({'User-Agent': USER_AGENT})
    return session


def gias_latest_zip(selected_tags: list[str]) -> tuple[bytes, str]:
    session = gias_session()
    session.get(GIAS_HOME_URL, timeout=REQUEST_TIMEOUT_SECONDS).raise_for_status()
    downloads_response = session.get(
        GIAS_DOWNLOADS_URL,
        headers={'Referer': GIAS_HOME_URL},
        timeout=REQUEST_TIMEOUT_SECONDS,
    )
    downloads_response.raise_for_status()

    payload_fields, tag_indices, file_dates = parse_download_form(downloads_response.text)
    payload = list(payload_fields)
    selected_date_strings: list[str] = []
    for tag in selected_tags:
        if tag not in tag_indices:
            raise RuntimeError(f'Missing expected GIAS tag {tag}')
        index = tag_indices[tag]
        payload.append((f'Downloads[{index}].Selected', 'true'))
        if index in file_dates:
            selected_date_strings.append(file_dates[index])

    collate_response = session.post(
        GIAS_COLLATE_URL,
        data=payload,
        headers={'Referer': GIAS_DOWNLOADS_URL},
        timeout=REQUEST_TIMEOUT_SECONDS,
        allow_redirects=False,
    )
    if collate_response.status_code not in {302, 303}:
        raise RuntimeError(f'Unexpected GIAS collate status {collate_response.status_code}')

    generated_url = urljoin(GIAS_HOME_URL, collate_response.headers['Location'])
    generated_id = generated_url.rstrip('/').rsplit('/', 1)[-1]

    for _ in range(POLL_MAX_ATTEMPTS):
        poll_response = session.get(
            f'{GIAS_GENERATE_AJAX_PREFIX}{generated_id}',
            headers={'Referer': generated_url},
            timeout=REQUEST_TIMEOUT_SECONDS,
        )
        poll_response.raise_for_status()
        payload = parse_nested_json_payload(poll_response.text)
        if payload.get('status'):
            break
        time.sleep(POLL_SLEEP_SECONDS)
    else:
        raise RuntimeError('GIAS download generation timed out')

    generated_page = session.get(
        generated_url,
        headers={'Referer': GIAS_DOWNLOADS_URL},
        timeout=REQUEST_TIMEOUT_SECONDS,
    )
    generated_page.raise_for_status()
    extract_payload = parse_generated_extract_form(generated_page.text)

    extract_response = session.post(
        GIAS_EXTRACT_URL,
        data=extract_payload,
        headers={'Referer': generated_url},
        timeout=REQUEST_TIMEOUT_SECONDS,
    )
    extract_response.raise_for_status()

    parsed_dates = [
        datetime.strptime(raw_date, '%m/%d/%Y %I:%M:%S %p').date()
        for raw_date in selected_date_strings
    ]
    latest_date = max(parsed_dates).isoformat() if parsed_dates else datetime.utcnow().date().isoformat()
    return extract_response.content, latest_date


def gias_school_records() -> tuple[dict[str, dict[str, Any]], str]:
    zip_bytes, generated_date = gias_latest_zip([ALL_ESTABLISHMENTS_TAG, STATE_FUNDED_TAG])

    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as archive:
        archive_members = archive.namelist()
        state_member = next(
            name for name in archive_members if 'statefunded' in name.lower() and name.lower().endswith('.csv')
        )
        all_member = next(
            name
            for name in archive_members
            if 'alldata' in name.lower() and name.lower().endswith('.csv') and 'statefunded' not in name.lower()
        )

        state_funded_urns: set[str] = set()
        with archive.open(state_member) as handle:
            reader = csv.DictReader(io.TextIOWrapper(handle, encoding='cp1252', newline=''))
            for row in reader:
                state_funded_urns.add(row['URN'])

        school_records: dict[str, dict[str, Any]] = {}
        with archive.open(all_member) as handle:
            reader = csv.DictReader(io.TextIOWrapper(handle, encoding='cp1252', newline=''))
            for row in reader:
                urn = row['URN']
                if urn not in state_funded_urns:
                    continue
                if row['EstablishmentStatus (name)'] != 'Open':
                    continue

                try:
                    easting = float(row['Easting'])
                    northing = float(row['Northing'])
                except ValueError:
                    continue

                school_records[urn] = {
                    'name': row['EstablishmentName'],
                    'phase': row['PhaseOfEducation (name)'],
                    'easting': easting,
                    'northing': northing,
                }

    return school_records, generated_date


def csv_rows(url: str) -> list[dict[str, str]]:
    response = requests.get(url, headers={'User-Agent': USER_AGENT}, timeout=REQUEST_TIMEOUT_SECONDS)
    response.raise_for_status()
    return list(csv.DictReader(io.StringIO(response.text)))


def primary_quality_scores(school_records: dict[str, dict[str, Any]]) -> tuple[dict[str, float], str]:
    rows = csv_rows(PRIMARY_PERFORMANCE_URL)

    filtered_rows = [row for row in rows if row['geographic_level'] == 'School']
    latest_time_period = max(row['time_period'] for row in filtered_rows)
    version_priority = {'Revised': 3, 'Final': 2, 'Provisional': 1}
    latest_version = max(
        (row['version'] for row in filtered_rows if row['time_period'] == latest_time_period),
        key=lambda value: version_priority.get(value, 0),
    )

    metrics_by_urn: dict[str, dict[str, float | None]] = {}
    for row in filtered_rows:
        if row['time_period'] != latest_time_period or row['version'] != latest_version:
            continue
        if row['breakdown_topic'] != 'All pupils' or row['breakdown'] != 'Total':
            continue
        urn = row['school_urn']
        if urn not in school_records:
            continue

        metrics = metrics_by_urn.setdefault(urn, {})
        subject = row['subject']
        if subject == 'Reading, writing and maths':
            metrics['expected'] = safe_float(row['expected_standard_pupil_percent'])
            metrics['higher'] = safe_float(row['higher_standard_pupil_percent'])
        elif subject == 'Reading':
            metrics['reading_progress'] = safe_float(row['progress_measure_score'])
            metrics['reading_scaled'] = safe_float(row['average_scaled_score'])
        elif subject == 'Mathematics':
            metrics['maths_progress'] = safe_float(row['progress_measure_score'])
            metrics['maths_scaled'] = safe_float(row['average_scaled_score'])

    return percentile_quality_scores(metrics_by_urn, PRIMARY_QUALITY_WEIGHTS), f'{latest_time_period} {latest_version}'


def secondary_quality_scores(school_records: dict[str, dict[str, Any]]) -> tuple[dict[str, float], str]:
    rows = csv_rows(SECONDARY_PERFORMANCE_URL)

    filtered_rows = [row for row in rows if row['geographic_level'] == 'School']
    latest_time_period = max(row['time_period'] for row in filtered_rows)
    version_priority = {'Revised': 3, 'Final': 2, 'Provisional': 1}
    latest_version = max(
        (row['version'] for row in filtered_rows if row['time_period'] == latest_time_period),
        key=lambda value: version_priority.get(value, 0),
    )

    metrics_by_urn: dict[str, dict[str, float | None]] = {}
    for row in filtered_rows:
        if row['time_period'] != latest_time_period or row['version'] != latest_version:
            continue
        if row['breakdown_topic'] != 'Total' or row['breakdown'] != 'Total':
            continue
        if not all(
            row[key] == 'Total'
            for key in ['sex', 'disadvantage', 'first_language', 'prior_attainment', 'mobility']
        ):
            continue

        urn = row['school_urn']
        if urn not in school_records:
            continue

        metrics_by_urn[urn] = {
            'p8': safe_float(row['avg_p8score']),
            'att8': safe_float(row['avg_att8']),
            'basics4': safe_float(row['pt_l2basics_94']),
            'ebacc4': safe_float(row['pt_ebacc_94']),
        }

    return percentile_quality_scores(metrics_by_urn, SECONDARY_QUALITY_WEIGHTS), f'{latest_time_period} {latest_version}'


def count_nearby_schools(
    anchor_easting: float,
    anchor_northing: float,
    school_records: dict[str, dict[str, Any]],
    *,
    allowed_phases: set[str],
    radius_meters: float,
) -> int:
    return sum(
        1
        for record in school_records.values()
        if record['phase'] in allowed_phases
        and math.hypot(record['easting'] - anchor_easting, record['northing'] - anchor_northing)
        <= radius_meters
    )


def methodology_note(primary_period: str, secondary_period: str) -> str:
    return (
        'Nearby school counts and quality now use state-funded-only DfE sources. '
        'Counts come from open state-funded GIAS establishment exports, excluding private schools. '
        'Primary quality is a percentile-based composite from '
        f'KS2 {primary_period} official school-level results '
        '(expected standard in reading, writing and maths, higher standard, reading progress, maths progress, reading scaled score, maths scaled score). '
        'Secondary quality is a percentile-based composite from '
        f'KS4 {secondary_period} official school-level results '
        '(Progress 8, Attainment 8, grade 4+ English and maths, and EBacc grade 4+). '
        'Station-level quality uses inverse-distance weighting across the surrounding state-funded schools.'
    )


def refresh_source_metadata(gias_release_date: str, primary_period: str, secondary_period: str) -> None:
    source_metadata = read_json(SOURCE_METADATA_PATH)
    source_metadata['schools'] = {
        'source': 'DfE GIAS open state-funded establishment exports + DfE Explore Education Statistics school performance data',
        'referencePeriod': (
            f'Counts refreshed from GIAS open state-funded export dated {gias_release_date}; '
            f'primary quality from KS2 {primary_period}; secondary quality from KS4 {secondary_period}'
        ),
        'releaseDate': gias_release_date,
    }
    write_json(SOURCE_METADATA_PATH, source_metadata)


def generate_school_metrics() -> dict[str, dict[str, Any]]:
    anchor_coordinates = read_json(ANCHOR_COORDINATES_PATH)
    school_records, gias_release_date = gias_school_records()
    primary_scores, primary_period = primary_quality_scores(school_records)
    secondary_scores, secondary_period = secondary_quality_scores(school_records)
    note = methodology_note(primary_period, secondary_period)

    output: dict[str, dict[str, Any]] = {}
    for station_code, anchor in anchor_coordinates.items():
        anchor_easting = float(anchor['easting'])
        anchor_northing = float(anchor['northing'])

        nearby_primary_count = count_nearby_schools(
            anchor_easting,
            anchor_northing,
            school_records,
            allowed_phases=PRIMARY_PHASES,
            radius_meters=PRIMARY_RADIUS_METERS,
        )
        nearby_secondary_count = count_nearby_schools(
            anchor_easting,
            anchor_northing,
            school_records,
            allowed_phases=SECONDARY_PHASES,
            radius_meters=SECONDARY_RADIUS_METERS,
        )
        primary_quality = proximity_weighted_quality(
            anchor_easting,
            anchor_northing,
            school_records,
            primary_scores,
            allowed_phases=PRIMARY_PHASES,
            radius_meters=PRIMARY_RADIUS_METERS,
        )
        secondary_quality = proximity_weighted_quality(
            anchor_easting,
            anchor_northing,
            school_records,
            secondary_scores,
            allowed_phases=SECONDARY_PHASES,
            radius_meters=SECONDARY_RADIUS_METERS,
        )

        output[station_code] = {
            'nearby_primary_count': nearby_primary_count,
            'nearby_secondary_count': nearby_secondary_count,
            'primary_quality_score': None if primary_quality is None else round(primary_quality, 1),
            'secondary_quality_score': None if secondary_quality is None else round(secondary_quality, 1),
            'status': 'available',
            'confidence': 0.88,
            'methodology_note': note,
        }

    refresh_source_metadata(gias_release_date, primary_period, secondary_period)
    return output


def main() -> None:
    payload = generate_school_metrics()
    write_json(OUTPUT_PATH, payload)
    print(f'Generated school metrics for {len(payload)} anchor stations -> {OUTPUT_PATH}')


if __name__ == '__main__':
    main()
