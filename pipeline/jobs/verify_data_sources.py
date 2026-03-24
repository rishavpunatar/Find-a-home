from __future__ import annotations

import argparse
import json
import math
import subprocess
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo


ROOT = Path(__file__).resolve().parents[2]
PROCESSED_DIR = ROOT / 'data' / 'processed'
DATASET_PATH = PROCESSED_DIR / 'micro_areas.json'
REPORT_PATH = PROCESSED_DIR / 'verification_report.json'


def fetch_json(url: str, timeout_seconds: float = 20.0) -> Any:
    try:
        request = urllib.request.Request(
            url,
            headers={
                'User-Agent': 'find-a-home-pipeline/0.1 (+https://github.com/rishavpunatar/Find-a-home)',
                'Accept': 'application/json',
            },
        )
        with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
            return json.loads(response.read().decode('utf-8'))
    except Exception as urllib_error:  # noqa: BLE001
        # Fallback for environments where python SSL/TLS support is older than remote endpoint requirements.
        try:
            result = subprocess.run(
                ['curl', '-sS', '--fail', url],
                check=True,
                capture_output=True,
                text=True,
                timeout=timeout_seconds,
            )
            return json.loads(result.stdout)
        except Exception as curl_error:  # noqa: BLE001
            raise RuntimeError(
                f'Unable to fetch JSON from {url}. urllib error: {urllib_error}. curl error: {curl_error}',
            ) from curl_error


def rank_values(values: list[float]) -> list[float]:
    indexed = sorted(enumerate(values), key=lambda pair: pair[1])
    ranks = [0.0] * len(values)

    idx = 0
    while idx < len(indexed):
        value = indexed[idx][1]
        tie_end = idx
        while tie_end + 1 < len(indexed) and indexed[tie_end + 1][1] == value:
            tie_end += 1

        # Average rank for ties (1-based rank)
        average_rank = (idx + tie_end + 2) / 2
        for tie_idx in range(idx, tie_end + 1):
            original_pos = indexed[tie_idx][0]
            ranks[original_pos] = average_rank

        idx = tie_end + 1

    return ranks


def pearson_correlation(left: list[float], right: list[float]) -> float | None:
    if len(left) != len(right) or len(left) < 2:
        return None

    left_mean = sum(left) / len(left)
    right_mean = sum(right) / len(right)

    numerator = sum((l - left_mean) * (r - right_mean) for l, r in zip(left, right))
    left_den = math.sqrt(sum((l - left_mean) ** 2 for l in left))
    right_den = math.sqrt(sum((r - right_mean) ** 2 for r in right))

    if left_den == 0 or right_den == 0:
        return None

    return numerator / (left_den * right_den)


def spearman_rank_correlation(left: list[float], right: list[float]) -> float | None:
    if len(left) != len(right) or len(left) < 2:
        return None

    left_ranked = rank_values(left)
    right_ranked = rank_values(right)
    return pearson_correlation(left_ranked, right_ranked)


def load_dataset(dataset_path: Path) -> dict[str, Any]:
    return json.loads(dataset_path.read_text(encoding='utf-8'))


def source_matrix() -> dict[str, dict[str, str]]:
    return {
        'property': {
            'status': 'not_live_verified',
            'primarySource': 'HM Land Registry Price Paid Data',
            'secondarySource': 'ONS UK House Price Index (planned cross-check)',
            'note': (
                'Current MVP uses fixture-backed sample property metrics. '
                'Live adapter and secondary statistical reconciliation still required.'
            ),
        },
        'transport': {
            'status': 'not_live_verified',
            'primarySource': 'TfL/National Rail journey-time feeds (planned)',
            'secondarySource': 'Google/other routing benchmark (planned)',
            'note': 'Current commute and frequency metrics are fixture-backed estimates.',
        },
        'schools': {
            'status': 'not_live_verified',
            'primarySource': 'DfE GIAS data exports',
            'secondarySource': 'Ofsted reports and CSCP performance feeds',
            'note': (
                'Current school metrics are fixture-backed composites. '
                'Ofsted grading/report-card transition requires careful mapping.'
            ),
        },
        'pollution': {
            'status': 'source_applied_not_cross_verified',
            'primarySource': 'DEFRA UK-AIR PCM modelled background grids',
            'secondarySource': 'LA AQMA station-level/open pollutant feeds (planned)',
            'note': (
                'NO2/PM2.5 now use DEFRA LAQM background-map values mapped to nearest 1km grid cells. '
                'Secondary source reconciliation is still pending.'
            ),
        },
        'greenSpace': {
            'status': 'not_live_verified',
            'primarySource': 'OS Open Greenspace',
            'secondarySource': 'Local authority park inventories (planned)',
            'note': 'Current greenspace and park-distance values are fixture-backed proxies.',
        },
        'crime': {
            'status': 'live_cross_check_available',
            'primarySource': 'Fixture-based annualised crime-rate proxy',
            'secondarySource': 'data.police.uk street-level monthly crime incidents',
            'note': (
                'Live cross-check compares relative station ordering from monthly incident counts. '
                'It is not a direct like-for-like per-1,000 replacement metric.'
            ),
        },
        'population': {
            'status': 'not_live_verified',
            'primarySource': 'Fixture-based denominator proxy',
            'secondarySource': 'ONS mid-year estimates + lookup mapping (planned)',
            'note': 'Current population denominators are fixture-based estimates.',
        },
        'planning': {
            'status': 'low_confidence_placeholder',
            'primarySource': 'Heuristic placeholder',
            'secondarySource': 'planning.data.gov.uk + LA planning application feeds (planned)',
            'note': (
                'Planning risk remains explicitly low-confidence until authoritative structured '
                'planning layers are integrated and quality-assured.'
            ),
        },
    }


def fetch_latest_police_month() -> str:
    dates = fetch_json('https://data.police.uk/api/crimes-street-dates')
    if not isinstance(dates, list) or not dates:
        raise ValueError('No date payload returned by data.police.uk')

    # The API typically returns latest-first; sort for safety.
    month_values = [str(item.get('date')) for item in dates if isinstance(item, dict) and item.get('date')]
    if not month_values:
        raise ValueError('No valid crime month values returned by data.police.uk')

    return sorted(month_values, reverse=True)[0]


def fetch_live_crime_count(lat: float, lon: float, month: str) -> int:
    query = urllib.parse.urlencode({'lat': f'{lat:.6f}', 'lng': f'{lon:.6f}', 'date': month})
    url = f'https://data.police.uk/api/crimes-street/all-crime?{query}'
    payload = fetch_json(url)
    if not isinstance(payload, list):
        raise ValueError('Unexpected crime payload structure')
    return len(payload)


def build_crime_cross_check(dataset: dict[str, Any], live_mode: bool) -> dict[str, Any]:
    micro_areas = dataset.get('microAreas', [])

    base_result: dict[str, Any] = {
        'status': 'not_run',
        'method': (
            'Spearman rank correlation between fixture annualised crime-rate proxy and '
            'data.police.uk monthly incidents annualised per 1,000 using local denominator.'
        ),
        'latestMonth': None,
        'stationSampleSize': 0,
        'spearmanRankCorrelation': None,
        'stations': [],
        'notes': [],
    }

    if not live_mode:
        base_result['status'] = 'skipped'
        base_result['notes'].append('Live verification skipped (run with --live to execute).')
        return base_result

    try:
        latest_month = fetch_latest_police_month()
    except Exception as error:  # noqa: BLE001
        base_result['status'] = 'error'
        base_result['notes'].append(f'Unable to fetch latest data.police.uk month: {error}')
        return base_result

    base_result['latestMonth'] = latest_month

    fixture_values: list[float] = []
    live_values: list[float] = []

    for area in micro_areas:
        lat = area.get('centroid', {}).get('lat')
        lon = area.get('centroid', {}).get('lon')
        fixture_crime = area.get('crimeRatePerThousand', {}).get('value')
        population = area.get('populationDenominator')

        if lat is None or lon is None or fixture_crime is None:
            continue

        station_row: dict[str, Any] = {
            'microAreaId': area.get('microAreaId'),
            'stationCode': area.get('stationCode'),
            'stationName': area.get('stationName'),
            'fixtureCrimeRatePerThousand': fixture_crime,
            'liveMonthlyCrimes': None,
            'liveAnnualisedRatePerThousand': None,
            'populationDenominator': population,
            'status': 'missing',
            'note': '',
        }

        try:
            monthly_count = fetch_live_crime_count(float(lat), float(lon), latest_month)
            station_row['liveMonthlyCrimes'] = monthly_count
            if isinstance(population, (int, float)) and population > 0:
                live_annualised_rate = (monthly_count * 12 * 1000) / float(population)
                station_row['liveAnnualisedRatePerThousand'] = round(live_annualised_rate, 2)
                fixture_values.append(float(fixture_crime))
                live_values.append(float(live_annualised_rate))
                station_row['status'] = 'ok'
                station_row['note'] = (
                    'Live incident count fetched from data.police.uk and annualised using population denominator.'
                )
            else:
                station_row['status'] = 'insufficient_population'
                station_row['note'] = (
                    'Live incident count fetched but no population denominator available for per-1,000 conversion.'
                )
        except urllib.error.HTTPError as error:
            station_row['status'] = 'http_error'
            station_row['note'] = f'data.police.uk HTTP error {error.code}'
        except urllib.error.URLError as error:
            station_row['status'] = 'network_error'
            station_row['note'] = f'data.police.uk network error: {error.reason}'
        except Exception as error:  # noqa: BLE001
            station_row['status'] = 'error'
            station_row['note'] = f'Unexpected error: {error}'

        base_result['stations'].append(station_row)

    base_result['stationSampleSize'] = len(fixture_values)

    correlation = spearman_rank_correlation(fixture_values, live_values)
    if correlation is None:
        base_result['status'] = 'insufficient_data'
        base_result['notes'].append('Insufficient paired data to compute rank correlation.')
        return base_result

    base_result['spearmanRankCorrelation'] = round(correlation, 4)

    if correlation >= 0.7:
        base_result['status'] = 'strong_alignment'
        base_result['notes'].append('Strong positive rank alignment between fixture and live crime signals.')
    elif correlation >= 0.4:
        base_result['status'] = 'moderate_alignment'
        base_result['notes'].append('Moderate rank alignment; fixture crime ordering is directionally plausible.')
    else:
        base_result['status'] = 'weak_alignment'
        base_result['notes'].append('Weak alignment; fixture crime proxy should be recalibrated.')

    base_result['notes'].append(
        'Live check annualises one month of incidents and is still a partial signal, not a full-year replacement.',
    )

    return base_result


def generate_verification_report(dataset: dict[str, Any], live_mode: bool = False) -> dict[str, Any]:
    generated_at = datetime.now(ZoneInfo('Europe/London')).isoformat(timespec='seconds')

    matrix = source_matrix()
    crime_check = build_crime_cross_check(dataset, live_mode=live_mode)

    overall_status = 'partial'
    if crime_check['status'] in {'strong_alignment', 'moderate_alignment'}:
        overall_status = 'partial_with_live_signal'
    if crime_check['status'] in {'weak_alignment', 'error'}:
        overall_status = 'attention_required'

    return {
        'generatedAt': generated_at,
        'methodologyVersion': dataset.get('methodologyVersion'),
        'overallStatus': overall_status,
        'sourceMatrix': matrix,
        'crossChecks': {
            'crime': crime_check,
        },
        'limitations': [
            'Property, schools, pollution, greenspace, transport, and population are not yet live cross-verified in this MVP.',
            'Planning risk is intentionally low-confidence placeholder data until structured feeds are integrated.',
            'This report improves transparency but is not equivalent to a full production data-audit pipeline.',
        ],
    }


def write_report(report: dict[str, Any], report_path: Path) -> None:
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, indent=2, ensure_ascii=True), encoding='utf-8')


def run(dataset_path: Path = DATASET_PATH, report_path: Path = REPORT_PATH, live_mode: bool = False) -> dict[str, Any]:
    dataset = load_dataset(dataset_path)
    report = generate_verification_report(dataset, live_mode=live_mode)
    write_report(report, report_path)
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description='Generate data-source verification report.')
    parser.add_argument('--live', action='store_true', help='Run live cross-checks (currently crime only).')
    parser.add_argument('--dataset', type=Path, default=DATASET_PATH)
    parser.add_argument('--output', type=Path, default=REPORT_PATH)
    args = parser.parse_args()

    report = run(dataset_path=args.dataset, report_path=args.output, live_mode=args.live)
    print(f"Verification report written to {args.output}")
    print(f"Overall status: {report['overallStatus']}")
    print(f"Crime check status: {report['crossChecks']['crime']['status']}")


if __name__ == '__main__':
    main()
