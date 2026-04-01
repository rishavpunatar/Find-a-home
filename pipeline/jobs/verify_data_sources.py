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
            'status': 'source_applied_not_live_verified',
            'primarySource': 'OnTheMarket current asking-price search results',
            'secondarySource': 'HM Land Registry Price Paid Data fallback',
            'note': (
                'Station-level property metrics now prefer current asking prices for semi-detached '
                'homes with 3+ bedrooms and 2+ bathrooms from public locality search results, '
                'using nearby locality/borough fallbacks only when the resulting listings still fall '
                'inside a bounded station-area radius. If live listing coverage is too thin, the pipeline '
                'falls back to recent HM Land Registry semi-detached transactions, first at the tighter '
                'local catchment and then an explicitly lower-confidence extended-area fallback.'
            ),
        },
        'transport': {
            'status': 'source_applied_partially_live_verified',
            'primarySource': 'TfL Journey Planner central-London core + TfL StopPoint arrivals + OSRM routing',
            'secondarySource': 'Station-profile fallback for uncovered routes',
            'note': (
                'Drive times now use direct OSRM routing where available. Public-transport commute metrics '
                'use TfL Journey Planner against a small central-London destination set, and service frequency '
                'can fall back to live TfL StopPoint arrivals where journey results are too sparse. Remaining '
                'uncovered stations retain an explicit station-profile heuristic fallback.'
            ),
        },
        'schools': {
            'status': 'source_applied_not_live_verified',
            'primarySource': 'DfE GIAS open state-funded establishment exports + DfE Explore Education Statistics KS2 and absence data',
            'secondarySource': 'Ofsted state-funded schools inspections and outcomes snapshot',
            'note': (
                'The school model is now primary-only. Access keeps the population-adjusted concept but '
                'replaces the old pure drive-time count with an admissions-aware reachability heuristic, '
                'while quality uses a smoothed KS2 attainment basket plus a light attendance supplement. '
                'Ofsted is only used as a warning overlay / penalty flag, not the main ranking driver.'
            ),
        },
        'pollution': {
            'status': 'source_applied_model_cross_checked',
            'primarySource': 'London Datastore LAEI (Greater London) + DEFRA UK-AIR LAQM background (elsewhere)',
            'secondarySource': 'DEFRA UK-AIR LAQM background (London cross-check) + live monitor feeds (planned)',
            'note': (
                'Greater London uses LAEI 20m modelled catchment values with DEFRA 1km background cross-check fields. '
                'Non-London currently uses DEFRA 1km catchment values. Live monitor reconciliation is still pending.'
            ),
        },
        'greenSpace': {
            'status': 'source_applied_not_live_verified',
            'primarySource': 'OpenStreetMap greenspace polygons via Overpass API',
            'secondarySource': 'OS Open Greenspace / local authority park inventories (planned)',
            'note': (
                'Greenspace area, cover, and nearest-park distance are now computed directly from station-level '
                'polygon geometry pulls rather than anchor-only fixture proxies.'
            ),
        },
        'crime': {
            'status': 'source_applied_live_cross_check_available',
            'primarySource': 'data.police.uk custom-area street-level crime pulls',
            'secondarySource': 'data.police.uk street-level monthly crime incidents',
            'note': (
                'Crime rates now use direct custom-area pulls from recent police street-level incidents, '
                'annualised with the station population denominator. Live cross-check still compares the '
                'resulting ordering against the same underlying police feed for sanity checking.'
            ),
        },
        'population': {
            'status': 'not_live_verified',
            'primarySource': 'Fixture-based denominator proxy',
            'secondarySource': 'ONS mid-year estimates + lookup mapping (planned)',
            'note': 'Current population denominators are fixture-based estimates.',
        },
        'planning': {
            'status': 'source_applied_not_live_verified',
            'primarySource': 'planning.data.gov.uk structured geometry layers',
            'secondarySource': 'Local planning-application feeds (planned)',
            'note': (
                'Planning risk now uses brownfield-land pressure plus conservation/article-4 constraint coverage '
                'from authoritative planning.data.gov.uk geometry layers. It remains a rule-based score rather '
                'than a direct planning-permission outcome measure.'
            ),
        },
        'wellbeing': {
            'status': 'source_applied_not_live_verified',
            'primarySource': 'ONS APS Personal well-being estimates by local authority',
            'secondarySource': 'No secondary cross-check wired yet',
            'note': (
                'Borough QoL uses latest ONS APS means for life satisfaction, worthwhile, '
                'happiness, and anxiety (inverted for positive-wellbeing composite).'
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
            'Spearman rank correlation between the stored station-area crime metric and '
            'a fresh data.police.uk monthly incident pull annualised per 1,000 using the local denominator.'
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
        base_result['notes'].append('Weak alignment; the stored crime metric should be recalibrated.')

    base_result['notes'].append(
        'Live check annualises one month of incidents and is still a partial signal, not a full-year replacement.',
    )

    return base_result


def compute_domain_coverage(dataset: dict[str, Any]) -> dict[str, Any]:
    domain_metric_keys = {
        'property': ['averageSemiDetachedPrice', 'medianSemiDetachedPrice'],
        'transport': [
            'commuteTypicalMinutes',
            'commutePeakMinutes',
            'commuteOffPeakMinutes',
            'serviceFrequencyPeakTph',
            'interchangeCount',
        ],
        'schools': [
            'nearbyPrimaryCount',
            'primaryQualityScore',
        ],
        'pollution': ['annualNo2', 'annualPm25'],
        'greenSpace': ['greenSpaceAreaKm2Within1km', 'greenCoverPct', 'nearestParkDistanceM'],
        'crime': ['crimeRatePerThousand'],
        'wellbeing': ['boroughQolScore'],
    }
    status_priority = {'available': 0, 'estimated': 1, 'placeholder': 2, 'missing': 3, 'other': 4}
    def is_source_applied_provenance(value: Any) -> bool:
        if not isinstance(value, str):
            return False
        return value == 'direct' or value == 'direct_blend' or value.startswith('direct_')
    scopes = {
        'default': dataset.get('microAreas', []),
        'londonWide': dataset.get('londonWideMicroAreas', []),
    }

    coverage: dict[str, Any] = {}
    for scope_name, areas in scopes.items():
        if not isinstance(areas, list):
            continue
        scope_result: dict[str, Any] = {'count': len(areas), 'domains': {}}
        for domain, metric_keys in domain_metric_keys.items():
            status_counts = {'available': 0, 'estimated': 0, 'placeholder': 0, 'missing': 0, 'other': 0}
            source_applied_slots = 0
            total_slots = len(areas) * len(metric_keys)
            for area in areas:
                metric_statuses: list[str] = []
                for metric_key in metric_keys:
                    metric = area.get(metric_key)
                    if isinstance(metric, dict):
                        status = metric.get('status')
                        provenance = metric.get('provenance')
                        if is_source_applied_provenance(provenance):
                            source_applied_slots += 1
                    else:
                        status = None
                    metric_statuses.append(str(status) if status in status_counts else 'other')

                status_key = sorted(metric_statuses, key=lambda candidate: status_priority[candidate], reverse=True)[0]
                status_counts[status_key] += 1

            total = len(areas) if areas else 1
            available_ratio = status_counts['available'] / total
            source_applied_ratio = source_applied_slots / total_slots if total_slots else 0.0
            scope_result['domains'][domain] = {
                'availablePct': round(available_ratio * 100, 2),
                'sourceAppliedPct': round(source_applied_ratio * 100, 2),
                'statusCounts': status_counts,
            }
        coverage[scope_name] = scope_result
    return coverage


def source_coverage_score(coverage: dict[str, Any]) -> float:
    ratios: list[float] = []
    for scope_payload in coverage.values():
        domains = scope_payload.get('domains', {})
        if not isinstance(domains, dict):
            continue
        for domain_payload in domains.values():
            source_applied_pct = domain_payload.get('sourceAppliedPct')
            if isinstance(source_applied_pct, (int, float)):
                ratios.append(float(source_applied_pct) / 100.0)
    if not ratios:
        return 0.0
    return round(sum(ratios) / len(ratios), 4)


def verification_strength_score(
    coverage: dict[str, Any],
    matrix: dict[str, dict[str, str]],
) -> float:
    benchmark_weight_by_status = {
        'source_applied_live_cross_check_available': 1.0,
        'source_applied_partially_live_verified': 0.88,
        'source_applied_model_cross_checked': 0.84,
        'source_applied_not_live_verified': 0.68,
        'not_live_verified': 0.45,
    }
    domain_weight = {
        'property': 1.15,
        'transport': 1.2,
        'schools': 1.1,
        'pollution': 1.0,
        'greenSpace': 0.95,
        'crime': 1.0,
        'planning': 0.75,
        'wellbeing': 0.7,
    }

    weighted_sum = 0.0
    total_weight = 0.0
    for scope_payload in coverage.values():
        domains = scope_payload.get('domains', {})
        if not isinstance(domains, dict):
            continue
        for domain, domain_payload in domains.items():
            source_applied_pct = domain_payload.get('sourceAppliedPct')
            if not isinstance(source_applied_pct, (int, float)):
                continue
            matrix_status = str(matrix.get(domain, {}).get('status', 'not_live_verified'))
            verification_weight = benchmark_weight_by_status.get(matrix_status, 0.4)
            importance = domain_weight.get(domain, 1.0)
            weighted_sum += (float(source_applied_pct) / 100.0) * verification_weight * importance
            total_weight += importance

    if total_weight == 0:
        return 0.0
    return round(weighted_sum / total_weight, 4)


def generate_verification_report(dataset: dict[str, Any], live_mode: bool = False) -> dict[str, Any]:
    generated_at = datetime.now(ZoneInfo('Europe/London')).isoformat(timespec='seconds')

    matrix = source_matrix()
    crime_check = build_crime_cross_check(dataset, live_mode=live_mode)
    domain_coverage = compute_domain_coverage(dataset)
    source_score = source_coverage_score(domain_coverage)
    strength_score = verification_strength_score(domain_coverage, matrix)

    overall_status = 'partial'
    if crime_check['status'] in {'strong_alignment', 'moderate_alignment'}:
        overall_status = 'partial_with_live_signal'
    if crime_check['status'] in {'weak_alignment', 'error'}:
        overall_status = 'attention_required'
    if source_score >= 0.85 and strength_score >= 0.6 and overall_status != 'attention_required':
        overall_status = 'strong_source_coverage'
    elif source_score >= 0.65 and strength_score >= 0.45 and overall_status == 'partial':
        overall_status = 'broad_source_coverage'
    elif source_score >= 0.75 and overall_status == 'partial':
        overall_status = 'source_rich_but_lightly_verified'
    if source_score < 0.45:
        overall_status = 'attention_required'

    return {
        'generatedAt': generated_at,
        'methodologyVersion': dataset.get('methodologyVersion'),
        'overallStatus': overall_status,
        'sourceCoverageScore': source_score,
        'verificationStrengthScore': strength_score,
        'verificationCompletenessScore': source_score,
        'sourceMatrix': matrix,
        'domainCoverage': domain_coverage,
        'crossChecks': {
            'crime': crime_check,
        },
        'limitations': [
            'Source coverage score reflects direct-source provenance, not independently audited accuracy.',
            'Verification strength score discounts domains that still lack a strong secondary benchmark or live reconciliation path.',
            'Property, schools, greenspace, transport, planning, and population still lack a full independent secondary benchmark.',
            'Pollution has model-to-model cross-checks (LAEI vs DEFRA) but still lacks full monitor-network reconciliation.',
            'Crime rates still depend on the station population denominator, which remains weaker than the new direct incident pull.',
            'Borough QoL currently uses ONS source application without a separate secondary cross-check.',
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
