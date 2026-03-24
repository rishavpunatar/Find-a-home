from __future__ import annotations

import argparse
import csv
import io
import json
import re
import subprocess
import urllib.error
import urllib.request
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo


ROOT = Path(__file__).resolve().parents[2]
OUTPUT_PATH = ROOT / 'data' / 'raw' / 'wellbeing_metrics.json'

ONS_DATASET_CSV_URL = (
    'https://download.ons.gov.uk/downloads/datasets/'
    'wellbeing-local-authority/editions/time-series/versions/4.csv'
)
ONS_DATASET_METADATA_URL = (
    'https://download.ons.gov.uk/downloads/datasets/'
    'wellbeing-local-authority/editions/time-series/versions/4.csv-metadata.json'
)

LOCAL_AUTHORITY_PREFIXES = {'E06', 'E07', 'E08', 'E09', 'W06', 'S12', 'N09'}

MEASURE_MAP = {
    'life satisfaction': 'life_satisfaction_mean',
    'worthwhile': 'worthwhile_mean',
    'happiness': 'happiness_mean',
    'anxiety': 'anxiety_mean',
}


def fetch_text(url: str, timeout_seconds: float = 30.0) -> str:
    request = urllib.request.Request(
        url,
        headers={
            'User-Agent': 'find-a-home-pipeline/0.1 (+https://github.com/rishavpunatar/Find-a-home)',
            'Accept': 'text/csv,application/json,text/plain,*/*',
        },
    )

    try:
        with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
            return response.read().decode('utf-8')
    except Exception as urllib_error:  # noqa: BLE001
        try:
            result = subprocess.run(
                ['curl', '-sS', '--fail', '-A', 'find-a-home-pipeline/0.1', url],
                check=True,
                capture_output=True,
                text=True,
                timeout=timeout_seconds,
            )
            return result.stdout
        except Exception as curl_error:  # noqa: BLE001
            raise RuntimeError(
                f'Failed to fetch {url}. urllib error: {urllib_error}. curl error: {curl_error}',
            ) from curl_error


def fetch_json(url: str, timeout_seconds: float = 30.0) -> dict[str, Any]:
    return json.loads(fetch_text(url, timeout_seconds=timeout_seconds))


def normalize_name(name: str) -> str:
    normalized = name.lower().strip().replace('&', ' and ')
    normalized = re.sub(r'[^a-z0-9]+', ' ', normalized)
    normalized = re.sub(r'\s+', ' ', normalized).strip()

    for prefix in (
        'city and county of ',
        'city of ',
        'london borough of ',
        'royal borough of ',
        'metropolitan borough of ',
        'borough of ',
        'district of ',
        'the ',
    ):
        if normalized.startswith(prefix):
            normalized = normalized[len(prefix) :]

    for suffix in (' london borough', ' borough', ' district'):
        if normalized.endswith(suffix):
            normalized = normalized[: -len(suffix)]

    return re.sub(r'\s+', ' ', normalized).strip()


def safe_float(raw_value: str) -> float | None:
    value = raw_value.strip()
    if not value:
        return None

    if value.startswith('[') and value.endswith(']'):
        return None

    try:
        return float(value)
    except ValueError:
        return None


def build_records(csv_text: str, metadata: dict[str, Any]) -> dict[str, Any]:
    grouped_by_geo_and_time: dict[str, dict[str, dict[str, Any]]] = defaultdict(lambda: defaultdict(dict))
    latest_time = ''

    reader = csv.DictReader(io.StringIO(csv_text))
    for row in reader:
        geography_code = str(row.get('administrative-geography', '')).strip()
        if geography_code[:3] not in LOCAL_AUTHORITY_PREFIXES:
            continue

        time_label = str(row.get('Time', '')).strip()
        if time_label and time_label > latest_time:
            latest_time = time_label

    if not latest_time:
        raise ValueError('Unable to determine latest APS period in ONS well-being dataset.')

    reader = csv.DictReader(io.StringIO(csv_text))
    for row in reader:
        geography_code = str(row.get('administrative-geography', '')).strip()
        if geography_code[:3] not in LOCAL_AUTHORITY_PREFIXES:
            continue

        if str(row.get('wellbeing-estimate', '')).strip().lower() != 'average-mean':
            continue

        geography_name = str(row.get('Geography', '')).strip()
        time_label = str(row.get('Time', '')).strip()
        if not geography_name or not time_label:
            continue

        measure = str(row.get('MeasureOfWellbeing', '')).strip().lower()
        metric_key = MEASURE_MAP.get(measure)
        if not metric_key:
            continue

        value = safe_float(str(row.get('v4_3', '')))
        if value is None:
            continue

        entry = grouped_by_geo_and_time[geography_name][time_label]
        entry['ons_geography_code'] = geography_code
        entry['ons_geography_name'] = geography_name
        entry['normalized_geography_name'] = normalize_name(geography_name)
        entry['period'] = time_label
        entry[metric_key] = value

    records: list[dict[str, Any]] = []
    for geography_name, by_time in grouped_by_geo_and_time.items():
        entry: dict[str, Any] | None = None
        for period in sorted(by_time.keys(), reverse=True):
            candidate = by_time[period]
            required = (
                'life_satisfaction_mean',
                'worthwhile_mean',
                'happiness_mean',
                'anxiety_mean',
            )
            if all(candidate.get(key) is not None for key in required):
                entry = candidate
                break

        if entry is None:
            continue

        required = (
            'life_satisfaction_mean',
            'worthwhile_mean',
            'happiness_mean',
            'anxiety_mean',
        )
        if any(entry.get(key) is None for key in required):
            continue

        positive_wellbeing_raw = (
            float(entry['life_satisfaction_mean'])
            + float(entry['worthwhile_mean'])
            + float(entry['happiness_mean'])
            + (10.0 - float(entry['anxiety_mean']))
        ) / 4.0
        positive_wellbeing_score = max(0.0, min(100.0, positive_wellbeing_raw * 10.0))

        records.append(
            {
                **entry,
                'qol_composite_raw_0_10': round(positive_wellbeing_raw, 3),
                'qol_score_0_100': round(positive_wellbeing_score, 2),
                'status': 'available',
                'confidence': 0.88,
                'methodology_note': (
                    'Derived from ONS APS personal well-being means for the latest period '
                    '(life satisfaction, worthwhile, happiness, and inverted anxiety), '
                    'aggregated to a positive well-being composite.'
                ),
            },
        )

    records.sort(key=lambda item: str(item.get('ons_geography_name', '')).lower())

    release_issued = str(metadata.get('dct:issued', ''))
    release_date = release_issued[:10] if len(release_issued) >= 10 else release_issued

    return {
        'source': {
            'name': 'ONS personal well-being estimates by local authority (APS)',
            'dataset': 'wellbeing-local-authority',
            'csvUrl': ONS_DATASET_CSV_URL,
            'metadataUrl': ONS_DATASET_METADATA_URL,
            'releaseDate': release_date,
            'accrualPeriodicity': metadata.get('dct:accrualPeriodicity'),
            'coveragePeriod': f'up to {latest_time}',
            'generatedAt': datetime.now(ZoneInfo('Europe/London')).isoformat(timespec='seconds'),
        },
        'records': records,
    }


def write_output(payload: dict[str, Any], output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(payload, indent=2, ensure_ascii=True), encoding='utf-8')


def main() -> None:
    parser = argparse.ArgumentParser(
        description='Generate borough QoL metrics from ONS APS personal well-being dataset.',
    )
    parser.add_argument('--output', type=Path, default=OUTPUT_PATH)
    parser.add_argument('--csv-url', default=ONS_DATASET_CSV_URL)
    parser.add_argument('--metadata-url', default=ONS_DATASET_METADATA_URL)
    args = parser.parse_args()

    csv_text = fetch_text(args.csv_url)
    metadata = fetch_json(args.metadata_url)
    payload = build_records(csv_text, metadata)
    write_output(payload, args.output)

    print(f"Wrote {len(payload['records'])} ONS well-being records to {args.output}")
    print(f"Coverage period: {payload['source']['coveragePeriod']}")
    print(f"Release date: {payload['source']['releaseDate']}")


if __name__ == '__main__':
    main()
