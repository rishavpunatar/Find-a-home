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
from typing import Any
from urllib.parse import urljoin

from pyproj import Transformer

from pipeline.jobs.station_scope import candidate_scope_stations
import requests


ROOT = Path(__file__).resolve().parents[2]
OUTPUT_PATH = ROOT / 'data' / 'raw' / 'schools_metrics.json'
SOURCE_METADATA_PATH = ROOT / 'data' / 'raw' / 'source_metadata.json'

GIAS_HOME_URL = 'https://www.get-information-schools.service.gov.uk/'
GIAS_DOWNLOADS_URL = f'{GIAS_HOME_URL}Downloads'
GIAS_COLLATE_URL = f'{GIAS_HOME_URL}Downloads/Collate'
GIAS_EXTRACT_URL = f'{GIAS_HOME_URL}Downloads/Download/Extract'
GIAS_GENERATE_AJAX_PREFIX = f'{GIAS_HOME_URL}Downloads/GenerateAjax/'

PRIMARY_PERFORMANCE_URL = (
    'https://explore-education-statistics.service.gov.uk/data-catalogue/data-set/'
    'f6cb50e9-0eca-4b1e-ac1a-6f6bb9d21a07/csv'
)
PRIMARY_ABSENCE_URL = (
    'https://explore-education-statistics.service.gov.uk/data-catalogue/data-set/'
    '1ef1689a-070a-4e0b-9314-512db23a3cc9/csv'
)
OFSTED_OUTCOMES_URL = (
    'https://assets.publishing.service.gov.uk/media/691ee0612a687551bd8153da/'
    'State-funded_schools_inspections_and_outcomes_as_at_31_August_2025.csv'
)
SECONDARY_PERFORMANCE_URL = (
    'https://explore-education-statistics.service.gov.uk/data-catalogue/data-set/'
    'c8f753ef-b76f-41a3-8949-13382e131054/csv'
)
OFSTED_REFERENCE_DATE = '2025-08-31'
MIN_SCORE_YEAR = 2023

USER_AGENT = (
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
    'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36'
)
REQUEST_TIMEOUT_SECONDS = 120
POLL_SLEEP_SECONDS = 2
POLL_MAX_ATTEMPTS = 90

ALL_ESTABLISHMENTS_TAG = 'all.edubase.data'
STATE_FUNDED_TAG = 'all.open.state-funded.schools'

DRIVE_CATCHMENT_MINUTES = 20.0
STRAIGHT_LINE_PREFILTER_METERS = 15_000.0
DRIVE_TIME_WEIGHT_FLOOR_MINUTES = 4.0
PRIMARY_DISTANCE_WEIGHT_STEPS: list[tuple[float, float]] = [
    (6.0, 1.0),
    (10.0, 0.82),
    (14.0, 0.55),
    (DRIVE_CATCHMENT_MINUTES, 0.25),
]
FAITH_ACCESS_FACTOR = 0.62
ALL_THROUGH_ACCESS_FACTOR = 0.9
PRIMARY_OFSTED_MAX_PENALTY = 10.0
PRIMARY_WARNING_SHARE_FOR_FULL_PENALTY = 0.45
NON_RESTRICTIVE_RELIGIOUS_CHARACTER_VALUES = {'', 'None', 'Does not apply'}

PRIMARY_PHASES = {'Primary', 'Middle deemed primary', 'All-through'}
SECONDARY_PHASES = {'Secondary', 'Middle deemed secondary', 'All-through'}
PRIMARY_QUALITY_WEIGHTS = {
    'expected': 0.4,
    'higher': 0.2,
    'reading_scaled': 0.2,
    'maths_scaled': 0.2,
}
PRIMARY_ATTENDANCE_WEIGHTS = {
    'overall_attendance': 0.55,
    'persistent_attendance': 0.45,
}
SECONDARY_QUALITY_WEIGHTS = {
    'p8': 0.50,
    'att8': 0.25,
    'basics4': 0.15,
    'ebacc4': 0.10,
}

INPUT_PATTERN = re.compile(r'<input[^>]+name="([^"]+)"[^>]+value="([^"]*)"', re.IGNORECASE)
OSGB_TO_WGS84 = Transformer.from_crs('EPSG:27700', 'EPSG:4326', always_xy=True)
WGS84_TO_OSGB = Transformer.from_crs('EPSG:4326', 'EPSG:27700', always_xy=True)


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding='utf-8'))


def write_json(path: Path, payload: Any) -> None:
    path.write_text(f'{json.dumps(payload, indent=2)}\n', encoding='utf-8')


def safe_float(raw_value: str | None) -> float | None:
    if raw_value in (None, '', 'z', 'x', 'u', 'c', 'SUPP', 'NA', 'NULL', 'Not set'):
        return None
    try:
        return float(raw_value)
    except ValueError:
        return None


def safe_int(raw_value: str | None) -> int | None:
    numeric_value = safe_float(raw_value)
    return None if numeric_value is None else int(numeric_value)


def clamp(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(maximum, value))


def average_available(values: list[float | None]) -> float | None:
    available_values = [value for value in values if value is not None]
    if not available_values:
        return None
    return sum(available_values) / len(available_values)


def time_period_start_year(raw_value: str | None) -> int | None:
    if not raw_value:
        return None

    match = re.search(r'(20\d{2})', raw_value)
    if not match:
        return None

    return int(match.group(1))


def eligible_latest_periods(rows: list[dict[str, str]], *, limit: int) -> list[str]:
    periods = sorted(
        {
            row['time_period']
            for row in rows
            if row.get('time_period') and (time_period_start_year(row['time_period']) or 0) >= MIN_SCORE_YEAR
        }
    )
    if not periods:
        raise RuntimeError(f'No eligible time periods found at or after {MIN_SCORE_YEAR}')
    return periods[-limit:]


def format_period_window(periods: list[str]) -> str:
    if not periods:
        return ''
    if len(periods) == 1 or periods[0] == periods[-1]:
        return periods[0]
    return f'{periods[0]}-{periods[-1]}'


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


def estimate_drive_minutes_from_distance(distance_m: float) -> float:
    road_adjusted_distance = distance_m * 1.28
    return 3.0 + (road_adjusted_distance / 550.0)


def school_drive_minutes_by_urn(
    _anchor_lat: float,
    _anchor_lon: float,
    anchor_easting: float,
    anchor_northing: float,
    school_records: dict[str, dict[str, Any]],
) -> dict[str, float]:
    candidate_schools = [
        (urn, record)
        for urn, record in school_records.items()
        if math.hypot(record['easting'] - anchor_easting, record['northing'] - anchor_northing)
        <= STRAIGHT_LINE_PREFILTER_METERS
    ]

    drive_minutes_by_urn: dict[str, float] = {}
    for urn, record in candidate_schools:
        straight_line_distance = math.hypot(
            record['easting'] - anchor_easting,
            record['northing'] - anchor_northing,
        )
        drive_minutes_by_urn[urn] = float(estimate_drive_minutes_from_distance(straight_line_distance))

    return drive_minutes_by_urn


def count_drive_catchment_schools(
    drive_minutes_by_urn: dict[str, float],
    school_records: dict[str, dict[str, Any]],
    *,
    allowed_phases: set[str],
) -> int:
    return sum(
        1
        for urn, drive_minutes in drive_minutes_by_urn.items()
        if drive_minutes <= DRIVE_CATCHMENT_MINUTES
        and school_records[urn]['phase'] in allowed_phases
    )


def drive_time_weighted_quality(
    drive_minutes_by_urn: dict[str, float],
    school_records: dict[str, dict[str, Any]],
    quality_scores: dict[str, float],
    *,
    allowed_phases: set[str],
) -> float | None:
    weighted_parts = [
        (quality_scores[urn], 1.0 / max(DRIVE_TIME_WEIGHT_FLOOR_MINUTES, drive_minutes))
        for urn, drive_minutes in drive_minutes_by_urn.items()
        if drive_minutes <= DRIVE_CATCHMENT_MINUTES
        and school_records[urn]['phase'] in allowed_phases
        and urn in quality_scores
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
                    'admissions_policy': row.get('AdmissionsPolicy (name)', ''),
                    'religious_character': row.get('ReligiousCharacter (name)', ''),
                    'school_capacity': safe_int(row.get('SchoolCapacity')),
                    'number_of_pupils': safe_int(row.get('NumberOfPupils')),
                    'easting': easting,
                    'northing': northing,
                    'lon': float(OSGB_TO_WGS84.transform(easting, northing)[0]),
                    'lat': float(OSGB_TO_WGS84.transform(easting, northing)[1]),
                }

    return school_records, generated_date


def csv_rows(url: str) -> list[dict[str, str]]:
    response = requests.get(url, headers={'User-Agent': USER_AGENT}, timeout=REQUEST_TIMEOUT_SECONDS)
    response.raise_for_status()
    for encoding in ('utf-8-sig', 'cp1252'):
        try:
            return list(csv.DictReader(io.StringIO(response.content.decode(encoding))))
        except UnicodeDecodeError:
            continue
    raise UnicodeDecodeError('csv_rows', b'', 0, 0, f'Unsupported CSV encoding for {url}')


def primary_quality_scores(school_records: dict[str, dict[str, Any]]) -> tuple[dict[str, float], str]:
    rows = csv_rows(PRIMARY_PERFORMANCE_URL)
    filtered_rows = [row for row in rows if row['geographic_level'] == 'School']
    version_priority = {'Revised': 3, 'Final': 2, 'Provisional': 1}
    latest_periods = eligible_latest_periods(filtered_rows, limit=3)
    selected_versions = {
        period: max(
            (row['version'] for row in filtered_rows if row['time_period'] == period),
            key=lambda value: version_priority.get(value, 0),
        )
        for period in latest_periods
    }

    yearly_metrics_by_urn: dict[str, dict[str, list[float | None]]] = {}
    for row in filtered_rows:
        period = row['time_period']
        if period not in selected_versions or row['version'] != selected_versions[period]:
            continue
        if row['breakdown_topic'] != 'All pupils' or row['breakdown'] != 'Total':
            continue

        urn = row['school_urn']
        if urn not in school_records:
            continue

        metrics = yearly_metrics_by_urn.setdefault(urn, {})
        subject = row['subject']
        if subject == 'Reading, writing and maths':
            metrics.setdefault('expected', []).append(safe_float(row['expected_standard_pupil_percent']))
            metrics.setdefault('higher', []).append(safe_float(row['higher_standard_pupil_percent']))
        elif subject == 'Reading':
            metrics.setdefault('reading_scaled', []).append(safe_float(row['average_scaled_score']))
        elif subject == 'Mathematics':
            metrics.setdefault('maths_scaled', []).append(safe_float(row['average_scaled_score']))

    averaged_metrics_by_urn = {
        urn: {
            metric_name: average_available(metric_values)
            for metric_name, metric_values in metrics.items()
        }
        for urn, metrics in yearly_metrics_by_urn.items()
    }

    return percentile_quality_scores(
        averaged_metrics_by_urn,
        PRIMARY_QUALITY_WEIGHTS,
    ), format_period_window(latest_periods)


def primary_attendance_scores(school_records: dict[str, dict[str, Any]]) -> tuple[dict[str, float], str]:
    rows = csv_rows(PRIMARY_ABSENCE_URL)

    filtered_rows = [
        row
        for row in rows
        if row['geographic_level'] == 'School' and row['education_phase'] == 'State-funded primary'
    ]
    latest_periods = eligible_latest_periods(filtered_rows, limit=3)

    yearly_metrics_by_urn: dict[str, dict[str, list[float | None]]] = {}
    for row in filtered_rows:
        if row['time_period'] not in latest_periods:
            continue

        urn = row['school_urn']
        if urn not in school_records:
            continue

        metrics = yearly_metrics_by_urn.setdefault(urn, {})
        metrics.setdefault('overall_attendance', []).append(
            None
            if safe_float(row['sess_overall_percent']) is None
            else -float(safe_float(row['sess_overall_percent']) or 0.0)
        )
        metrics.setdefault('persistent_attendance', []).append(
            None
            if safe_float(row['enrolments_pa_10_exact_percent']) is None
            else -float(safe_float(row['enrolments_pa_10_exact_percent']) or 0.0)
        )

    averaged_metrics_by_urn = {
        urn: {
            metric_name: average_available(metric_values)
            for metric_name, metric_values in metrics.items()
        }
        for urn, metrics in yearly_metrics_by_urn.items()
    }

    return percentile_quality_scores(
        averaged_metrics_by_urn,
        PRIMARY_ATTENDANCE_WEIGHTS,
    ), format_period_window(latest_periods)


def parse_ofsted_grade(raw_value: str | None) -> int | None:
    numeric_value = safe_int(raw_value)
    if numeric_value in {1, 2, 3, 4}:
        return numeric_value
    return None


def primary_ofsted_warning_severity(row: dict[str, str]) -> float:
    severity = 0.0

    overall = parse_ofsted_grade(row.get('Overall effectiveness'))
    if overall == 4:
        severity = max(severity, 1.0)
    elif overall == 3:
        severity = max(severity, 0.6)

    for field_name in [
        'Quality of education',
        'Behaviour and attitudes',
        'Effectiveness of leadership and management',
    ]:
        grade = parse_ofsted_grade(row.get(field_name))
        if grade == 4:
            severity = max(severity, 0.8)
        elif grade == 3:
            severity = max(severity, 0.4)

    if (row.get('Safeguarding is effective?') or '').strip().lower() == 'no':
        severity = max(severity, 1.0)

    warning_notices = safe_int(row.get('Number of warning notices issued in 2024/25 academic year'))
    if warning_notices and warning_notices > 0:
        severity = max(severity, min(1.0, 0.45 + warning_notices * 0.2))

    return severity


def primary_ofsted_warning_scores() -> tuple[dict[str, float], str]:
    rows = csv_rows(OFSTED_OUTCOMES_URL)
    return (
        {
            row['URN']: primary_ofsted_warning_severity(row)
            for row in rows
            if row.get('URN')
        },
        OFSTED_REFERENCE_DATE,
    )


def admissions_policy_factor(admissions_policy: str | None) -> float:
    normalized = (admissions_policy or '').strip()
    if normalized == 'Selective':
        return 0.2
    if normalized in {'', 'Unknown'}:
        return 0.85
    return 1.0


def faith_access_factor(religious_character: str | None) -> float:
    normalized = (religious_character or '').strip()
    return 1.0 if normalized in NON_RESTRICTIVE_RELIGIOUS_CHARACTER_VALUES else FAITH_ACCESS_FACTOR


def capacity_access_factor(capacity: int | None) -> float:
    if capacity is None or capacity <= 0:
        return 1.0
    return clamp(math.sqrt(capacity / 300.0), 0.85, 1.15)


def roll_pressure_access_factor(number_of_pupils: int | None, capacity: int | None) -> float:
    if number_of_pupils is None or number_of_pupils <= 0 or capacity is None or capacity <= 0:
        return 1.0

    utilisation = number_of_pupils / capacity
    if utilisation >= 1.05:
        return 0.82
    if utilisation >= 0.97:
        return 0.9
    if utilisation >= 0.9:
        return 0.96
    if utilisation <= 0.55:
        return 1.04
    return 1.0


def distance_access_factor(drive_minutes: float) -> float:
    for max_minutes, weight in PRIMARY_DISTANCE_WEIGHT_STEPS:
        if drive_minutes <= max_minutes:
            return weight
    return 0.0


def primary_accessibility_weight(drive_minutes: float, school_record: dict[str, Any]) -> float:
    if drive_minutes > DRIVE_CATCHMENT_MINUTES or school_record['phase'] not in PRIMARY_PHASES:
        return 0.0

    phase_factor = ALL_THROUGH_ACCESS_FACTOR if school_record['phase'] == 'All-through' else 1.0
    return (
        distance_access_factor(drive_minutes)
        * admissions_policy_factor(school_record.get('admissions_policy'))
        * faith_access_factor(school_record.get('religious_character'))
        * capacity_access_factor(school_record.get('school_capacity'))
        * roll_pressure_access_factor(
            school_record.get('number_of_pupils'),
            school_record.get('school_capacity'),
        )
        * phase_factor
    )


def primary_access_equivalent_count(
    drive_minutes_by_urn: dict[str, float],
    school_records: dict[str, dict[str, Any]],
) -> float:
    return sum(
        primary_accessibility_weight(drive_minutes, school_records[urn])
        for urn, drive_minutes in drive_minutes_by_urn.items()
    )


def primary_access_weighted_average(
    drive_minutes_by_urn: dict[str, float],
    school_records: dict[str, dict[str, Any]],
    metric_scores: dict[str, float],
) -> float | None:
    weighted_parts = [
        (metric_scores[urn], primary_accessibility_weight(drive_minutes, school_records[urn]))
        for urn, drive_minutes in drive_minutes_by_urn.items()
        if urn in metric_scores
    ]
    weighted_parts = [(value, weight) for value, weight in weighted_parts if weight > 0]
    return weighted_average(weighted_parts)


def primary_ofsted_warning_share(
    drive_minutes_by_urn: dict[str, float],
    school_records: dict[str, dict[str, Any]],
    warning_scores: dict[str, float],
) -> float | None:
    weighted_parts = [
        (warning_scores.get(urn, 0.0), primary_accessibility_weight(drive_minutes, school_records[urn]))
        for urn, drive_minutes in drive_minutes_by_urn.items()
    ]
    weighted_parts = [(value, weight) for value, weight in weighted_parts if weight > 0]
    return weighted_average(weighted_parts)


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


def methodology_note(
    primary_period: str,
    attendance_period: str,
    ofsted_period: str,
) -> str:
    return (
        'The current school model is primary-only and uses state-funded-only official sources. '
        'Counts come from open state-funded GIAS establishment exports, excluding private schools. '
        f'Reachable-primary access still starts from an approximate {DRIVE_CATCHMENT_MINUTES:.0f}-minute road-adjusted drive proxy, '
        'but schools are now downweighted when open admissions are less likely in practice: distance matters most, '
        'faith-designated schools are discounted, larger schools get a modest capacity uplift, schools that already look very full relative to their published capacity are penalised, '
        'and all-through schools get a small penalty. National open data does not directly expose sibling or feeder priorities or school-level cut-off distances, '
        'so this remains a cautious admissions-reachability heuristic rather than a true offer-probability model. '
        f'Primary quality now uses the latest eligible 2023-onward KS2 attainment basket from {primary_period} '
        '(combined expected standard, combined higher standard, average reading scaled score, average maths scaled score). '
        f'Attendance is a separate light-touch supplement from {attendance_period} official primary absence data '
        '(overall absence and persistent absence). '
        f'Ofsted is not the main driver: latest published inspection outcomes as at {ofsted_period} are used only as a warning overlay and modest penalty for weaker leadership, behaviour, safeguarding, or overall effectiveness.'
    )


def refresh_source_metadata(
    gias_release_date: str,
    primary_period: str,
    attendance_period: str,
    ofsted_period: str,
) -> None:
    source_metadata = read_json(SOURCE_METADATA_PATH)
    source_metadata['schools'] = {
        'source': (
            'DfE GIAS open state-funded establishment exports + DfE Explore Education Statistics '
            'KS2 and absence data + Ofsted state-funded schools inspections and outcomes'
        ),
        'referencePeriod': (
            f'Counts refreshed from GIAS open state-funded export dated {gias_release_date}; '
            f'primary attainment basket from 2023-onward KS2 {primary_period}; '
            f'attendance supplement from 2023-onward primary absence {attendance_period}; '
            f'Ofsted overlay as at {ofsted_period}'
        ),
        'releaseDate': gias_release_date,
    }
    write_json(SOURCE_METADATA_PATH, source_metadata)


def generate_school_metrics() -> dict[str, dict[str, Any]]:
    stations = candidate_scope_stations()
    school_records, gias_release_date = gias_school_records()
    primary_scores, primary_period = primary_quality_scores(school_records)
    attendance_scores, attendance_period = primary_attendance_scores(school_records)
    ofsted_warning_scores, ofsted_period = primary_ofsted_warning_scores()
    note = methodology_note(primary_period, attendance_period, ofsted_period)

    output: dict[str, dict[str, Any]] = {}
    for station in stations:
        anchor_easting, anchor_northing = WGS84_TO_OSGB.transform(
            station.coordinate.lon,
            station.coordinate.lat,
        )
        drive_minutes_by_urn = school_drive_minutes_by_urn(
            float(station.coordinate.lat),
            float(station.coordinate.lon),
            float(anchor_easting),
            float(anchor_northing),
            school_records,
        )

        raw_primary_count = count_drive_catchment_schools(
            drive_minutes_by_urn,
            school_records,
            allowed_phases=PRIMARY_PHASES,
        )
        nearby_primary_count = primary_access_equivalent_count(drive_minutes_by_urn, school_records)
        primary_quality = primary_access_weighted_average(drive_minutes_by_urn, school_records, primary_scores)
        primary_attendance = primary_access_weighted_average(
            drive_minutes_by_urn,
            school_records,
            attendance_scores,
        )
        ofsted_warning_share = primary_ofsted_warning_share(
            drive_minutes_by_urn,
            school_records,
            ofsted_warning_scores,
        )
        ofsted_penalty = (
            None
            if ofsted_warning_share is None
            else min(
                PRIMARY_OFSTED_MAX_PENALTY,
                (ofsted_warning_share / PRIMARY_WARNING_SHARE_FOR_FULL_PENALTY) * PRIMARY_OFSTED_MAX_PENALTY,
            )
        )

        output[station.station_code] = {
            'nearby_primary_count': round(nearby_primary_count, 1),
            'raw_primary_count_within_drive_proxy': raw_primary_count,
            'nearby_secondary_count': None,
            'primary_quality_score': None if primary_quality is None else round(primary_quality, 1),
            'primary_attendance_score': None if primary_attendance is None else round(primary_attendance, 1),
            'primary_ofsted_warning_share': (
                None if ofsted_warning_share is None else round(ofsted_warning_share * 100.0, 1)
            ),
            'primary_ofsted_penalty': None if ofsted_penalty is None else round(ofsted_penalty, 1),
            'secondary_quality_score': None,
            'status': 'available',
            'confidence': 0.84,
            'provenance': 'direct',
            'field_statuses': {
                'nearby_primary_count': 'available',
                'nearby_secondary_count': 'missing',
                'primary_quality_score': 'available',
                'secondary_quality_score': 'missing',
            },
            'field_confidences': {
                'nearby_primary_count': 0.82,
                'nearby_secondary_count': 0.2,
                'primary_quality_score': 0.87,
                'secondary_quality_score': 0.2,
            },
            'field_provenance': {
                'nearby_primary_count': 'direct',
                'nearby_secondary_count': 'missing',
                'primary_quality_score': 'direct',
                'secondary_quality_score': 'missing',
            },
            'methodology_note': note,
        }

    refresh_source_metadata(gias_release_date, primary_period, attendance_period, ofsted_period)
    return output


def main() -> None:
    payload = generate_school_metrics()
    write_json(OUTPUT_PATH, payload)
    print(f'Generated school metrics for {len(payload)} stations -> {OUTPUT_PATH}')


if __name__ == '__main__':
    main()
