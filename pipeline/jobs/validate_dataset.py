from __future__ import annotations

import argparse
import json
import math
import re
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo


ROOT = Path(__file__).resolve().parents[2]
DATASET_PATH = ROOT / 'data' / 'processed' / 'micro_areas.json'
POLLUTION_PATH = ROOT / 'data' / 'raw' / 'pollution_metrics.json'
REPORT_PATH = ROOT / 'data' / 'processed' / 'data_quality_report.json'
CONFIG_PATH = ROOT / 'pipeline' / 'config' / 'search_config.json'

ALLOWED_METRIC_STATUSES = {'available', 'estimated', 'placeholder', 'missing'}

NUMERIC_BOUNDS: dict[str, tuple[float, float]] = {
    'overallWeightedScore': (0.0, 100.0),
    'overlapConfidence': (0.0, 1.0),
    'dataConfidenceScore': (0.0, 1.0),
    'averageSemiDetachedPrice': (40_000.0, 8_000_000.0),
    'medianSemiDetachedPrice': (40_000.0, 8_000_000.0),
    'semiPriceTrendPct5y': (-90.0, 400.0),
    'commuteTypicalMinutes': (0.0, 240.0),
    'commutePeakMinutes': (0.0, 300.0),
    'commuteOffPeakMinutes': (0.0, 300.0),
    'serviceFrequencyPeakTph': (0.0, 80.0),
    'interchangeCount': (0.0, 10.0),
    'driveTimeToPinnerMinutes': (0.0, 300.0),
    'nearbyPrimaryCount': (0.0, 450.0),
    'nearbySecondaryCount': (0.0, 120.0),
    'primaryQualityScore': (0.0, 100.0),
    'secondaryQualityScore': (0.0, 100.0),
    'annualNo2': (2.0, 120.0),
    'annualPm25': (2.0, 60.0),
    'greenSpaceAreaKm2Within1km': (0.0, 5.0),
    'greenCoverPct': (0.0, 100.0),
    'nearestParkDistanceM': (0.0, 10_000.0),
    'nearestMainRoadDistanceM': (0.0, 10_000.0),
    'majorRoadLengthKmWithin1600m': (0.0, 100.0),
    'crimeRatePerThousand': (0.0, 4_000.0),
    'boroughQolScore': (0.0, 100.0),
}

COMPONENT_KEYS = {'transport', 'schools', 'environment', 'crime', 'roads'}
MIN_SCORE_SOURCE_YEAR = 2023
SCORE_SOURCE_DOMAINS = {
    'transport': 'transport',
    'schools': 'schools',
    'pollution': 'environment',
    'greenSpace': 'environment',
    'crime': 'crime',
    'roads': 'roads',
}
METRIC_FIELDS = [
    'averageSemiDetachedPrice',
    'medianSemiDetachedPrice',
    'semiPriceTrendPct5y',
    'commuteTypicalMinutes',
    'commutePeakMinutes',
    'commuteOffPeakMinutes',
    'serviceFrequencyPeakTph',
    'interchangeCount',
    'driveTimeToPinnerMinutes',
    'nearbyPrimaryCount',
    'nearbySecondaryCount',
    'primaryQualityScore',
    'secondaryQualityScore',
    'annualNo2',
    'annualPm25',
    'greenSpaceAreaKm2Within1km',
    'greenCoverPct',
    'nearestParkDistanceM',
    'nearestMainRoadDistanceM',
    'majorRoadLengthKmWithin1600m',
    'crimeRatePerThousand',
    'boroughQolScore',
]


THRESHOLD_YEAR_PATTERN = re.compile(
    r'\b(?:pre|post|before|after|since)\s*[-/]?(20\d{2})\b',
    flags=re.IGNORECASE,
)
COMPACT_ACADEMIC_YEAR_PATTERN = re.compile(r'(?<!\d)(20\d{2})(\d{2})(?!\d)')
SPLIT_ACADEMIC_YEAR_PATTERN = re.compile(r'(?<!\d)(20\d{2})\s*[/-]\s*(\d{2})(?!\d)')
FOUR_DIGIT_YEAR_PATTERN = re.compile(r'(?<!\d)(20\d{2})(?!\d)')


def extract_four_digit_years(*values: Any) -> list[int]:
    years: list[int] = []
    for value in values:
        if not isinstance(value, str):
            continue

        sanitized = THRESHOLD_YEAR_PATTERN.sub('', value)

        for start_year, end_suffix in COMPACT_ACADEMIC_YEAR_PATTERN.findall(sanitized):
            start = int(start_year)
            if int(end_suffix) == (start + 1) % 100:
                years.append(start)

        for start_year, end_suffix in SPLIT_ACADEMIC_YEAR_PATTERN.findall(sanitized):
            start = int(start_year)
            if int(end_suffix) == (start + 1) % 100:
                years.append(start)

        years.extend(int(match) for match in FOUR_DIGIT_YEAR_PATTERN.findall(sanitized))
    return years


def is_finite_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(float(value))


def issue(
    issues: list[dict[str, Any]],
    *,
    severity: str,
    code: str,
    message: str,
    area: dict[str, Any] | None = None,
    field: str | None = None,
    observed: Any = None,
    expected: str | None = None,
) -> None:
    payload: dict[str, Any] = {
        'severity': severity,
        'code': code,
        'message': message,
    }
    if area is not None:
        scope = area.get('_scope')
        if isinstance(scope, str) and scope:
            payload['scope'] = scope
        payload['microAreaId'] = area.get('microAreaId')
        payload['stationCode'] = area.get('stationCode')
        payload['stationName'] = area.get('stationName')
    if field:
        payload['field'] = field
    if observed is not None:
        payload['observed'] = observed
    if expected is not None:
        payload['expected'] = expected
    issues.append(payload)


def check_bounds(
    issues: list[dict[str, Any]],
    area: dict[str, Any],
    field: str,
    value: float,
    bounds: tuple[float, float],
) -> None:
    minimum, maximum = bounds
    if value < minimum or value > maximum:
        issue(
            issues,
            severity='critical',
            code='value_out_of_bounds',
            message=f'{field} is outside expected range.',
            area=area,
            field=field,
            observed=value,
            expected=f'[{minimum}, {maximum}]',
        )


def validate_metric_field(issues: list[dict[str, Any]], area: dict[str, Any], field: str) -> None:
    raw_metric = area.get(field)
    if not isinstance(raw_metric, dict):
        issue(
            issues,
            severity='critical',
            code='metric_missing',
            message='Metric object missing.',
            area=area,
            field=field,
        )
        return

    for required_key in ('value', 'status', 'confidence', 'provenance', 'methodologyNote', 'lastUpdated'):
        if required_key not in raw_metric:
            issue(
                issues,
                severity='critical',
                code='metric_key_missing',
                message=f'Metric key `{required_key}` missing.',
                area=area,
                field=field,
            )

    status = raw_metric.get('status')
    if status not in ALLOWED_METRIC_STATUSES:
        issue(
            issues,
            severity='critical',
            code='metric_invalid_status',
            message='Metric status is not recognized.',
            area=area,
            field=field,
            observed=status,
            expected=str(sorted(ALLOWED_METRIC_STATUSES)),
        )

    confidence = raw_metric.get('confidence')
    if not is_finite_number(confidence) or float(confidence) < 0 or float(confidence) > 1:
        issue(
            issues,
            severity='critical',
            code='metric_invalid_confidence',
            message='Metric confidence must be finite and between 0 and 1.',
            area=area,
            field=field,
            observed=confidence,
            expected='0 <= confidence <= 1',
        )

    value = raw_metric.get('value')
    if value is None:
        if status == 'available':
            issue(
                issues,
                severity='critical',
                code='metric_null_available',
                message='Metric is marked available but value is null.',
                area=area,
                field=field,
            )
        return

    if not is_finite_number(value):
        issue(
            issues,
            severity='critical',
            code='metric_non_numeric',
            message='Metric value must be numeric or null.',
            area=area,
            field=field,
            observed=value,
        )
        return

    bounds = NUMERIC_BOUNDS.get(field)
    if bounds:
        check_bounds(issues, area, field, float(value), bounds)


def validate_components(issues: list[dict[str, Any]], area: dict[str, Any]) -> None:
    components = area.get('componentScores')
    if not isinstance(components, dict):
        issue(
            issues,
            severity='critical',
            code='component_scores_missing',
            message='componentScores object missing.',
            area=area,
            field='componentScores',
        )
        return

    if COMPONENT_KEYS.difference(set(components.keys())):
        issue(
            issues,
            severity='critical',
            code='component_scores_keys',
            message='componentScores keys are incomplete.',
            area=area,
            field='componentScores',
            observed=sorted(components.keys()),
            expected=str(sorted(COMPONENT_KEYS)),
        )

    for key in COMPONENT_KEYS:
        value = components.get(key)
        if not is_finite_number(value):
            issue(
                issues,
                severity='critical',
                code='component_non_numeric',
                message='Component score must be numeric.',
                area=area,
                field=f'componentScores.{key}',
                observed=value,
            )
            continue
        check_bounds(issues, area, f'componentScores.{key}', float(value), (0.0, 100.0))


def validate_ranking_order(issues: list[dict[str, Any]], micro_areas: list[dict[str, Any]]) -> None:
    for idx in range(1, len(micro_areas)):
        previous_score = micro_areas[idx - 1].get('overallWeightedScore')
        current_score = micro_areas[idx].get('overallWeightedScore')
        if not is_finite_number(previous_score) or not is_finite_number(current_score):
            continue
        if float(previous_score) < float(current_score):
            issue(
                issues,
                severity='warning',
                code='ranking_order_inversion',
                message='Dataset is not strictly sorted descending by overallWeightedScore.',
                area=micro_areas[idx],
                field='overallWeightedScore',
                observed={'previous': previous_score, 'current': current_score},
            )
            return


def validate_pollution_consistency(
    issues: list[dict[str, Any]],
    area: dict[str, Any],
    pollution_record: dict[str, Any] | None,
) -> None:
    if not pollution_record:
        issue(
            issues,
            severity='warning',
            code='pollution_source_missing',
            message='No raw pollution source record found for station.',
            area=area,
            field='annualNo2',
        )
        return

    area_no2 = area.get('annualNo2', {}).get('value')
    area_pm25 = area.get('annualPm25', {}).get('value')
    raw_no2 = pollution_record.get('annual_no2')
    raw_pm25 = pollution_record.get('annual_pm25')

    if is_finite_number(area_no2) and is_finite_number(raw_no2):
        if abs(float(area_no2) - float(raw_no2)) > 1e-3:
            issue(
                issues,
                severity='critical',
                code='pollution_value_mismatch',
                message='Processed NO2 value does not match raw pollution feed.',
                area=area,
                field='annualNo2',
                observed=area_no2,
                expected=str(raw_no2),
            )

    if is_finite_number(area_pm25) and is_finite_number(raw_pm25):
        if abs(float(area_pm25) - float(raw_pm25)) > 1e-3:
            issue(
                issues,
                severity='critical',
                code='pollution_value_mismatch',
                message='Processed PM2.5 value does not match raw pollution feed.',
                area=area,
                field='annualPm25',
                observed=area_pm25,
                expected=str(raw_pm25),
            )

    secondary_no2 = pollution_record.get('secondary_source_no2')
    secondary_pm25 = pollution_record.get('secondary_source_pm25')
    if is_finite_number(secondary_no2) and is_finite_number(area_no2):
        no2_delta = abs(float(area_no2) - float(secondary_no2))
        if no2_delta > 25:
            issue(
                issues,
                severity='critical',
                code='pollution_cross_source_delta',
                message='NO2 divergence vs secondary source is unusually high.',
                area=area,
                field='annualNo2',
                observed=round(no2_delta, 3),
                expected='<= 25 ug/m3',
            )
        elif no2_delta > 18:
            issue(
                issues,
                severity='warning',
                code='pollution_cross_source_delta',
                message='NO2 divergence vs secondary source is high; review recommended.',
                area=area,
                field='annualNo2',
                observed=round(no2_delta, 3),
                expected='<= 18 ug/m3',
            )

    if is_finite_number(secondary_pm25) and is_finite_number(area_pm25):
        pm25_delta = abs(float(area_pm25) - float(secondary_pm25))
        if pm25_delta > 10:
            issue(
                issues,
                severity='critical',
                code='pollution_cross_source_delta',
                message='PM2.5 divergence vs secondary source is unusually high.',
                area=area,
                field='annualPm25',
                observed=round(pm25_delta, 3),
                expected='<= 10 ug/m3',
            )

    note = str(area.get('annualNo2', {}).get('methodologyNote') or '')
    if 'LAEI' in note:
        issue(
            issues,
            severity='critical',
            code='pollution_pre_2023_source',
            message='Pollution methodology note still references LAEI, which is pre-2023.',
            area=area,
            field='annualNo2.methodologyNote',
            observed=note,
        )
    elif 'DEFRA' not in note and 'PCM' not in note:
        issue(
            issues,
            severity='warning',
            code='pollution_source_note_unclear',
            message='Pollution methodology note does not clearly reference the DEFRA PCM source.',
            area=area,
            field='annualNo2.methodologyNote',
            observed=note,
        )


def validate_score_source_metadata(issues: list[dict[str, Any]], dataset: dict[str, Any]) -> None:
    config = dataset.get('config')
    if not isinstance(config, dict):
        return

    source_metadata = config.get('sourceMetadata')
    if not isinstance(source_metadata, dict):
        return

    for domain, axis in SCORE_SOURCE_DOMAINS.items():
        record = source_metadata.get(domain)
        if not isinstance(record, dict):
            continue

        years = extract_four_digit_years(record.get('referencePeriod'), record.get('releaseDate'))
        stale_years = sorted({year for year in years if year < MIN_SCORE_SOURCE_YEAR})
        if not stale_years:
            continue

        issue(
            issues,
            severity='critical',
            code='score_source_pre_2023',
            message=(
                f'Scored domain `{domain}` metadata still references pre-{MIN_SCORE_SOURCE_YEAR} years.'
            ),
            area={'_scope': 'dataset'},
            field=f'config.sourceMetadata.{domain}',
            observed={'years': stale_years, 'axis': axis},
            expected=f'All scored source years >= {MIN_SCORE_SOURCE_YEAR}',
        )


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding='utf-8'))


def load_default_weights(path: Path) -> dict[str, float]:
    payload = load_json(path)
    return payload.get('default_weights', {})


def recompute_overall_score(area: dict[str, Any], weights: dict[str, float]) -> float | None:
    component_scores = area.get('componentScores')
    confidence = area.get('dataConfidenceScore')
    if not isinstance(component_scores, dict):
        return None
    if not is_finite_number(confidence):
        return None

    from pipeline.models.scoring import weighted_score

    try:
        scores = {key: float(component_scores.get(key, 0.0)) for key in weights}
    except Exception:  # noqa: BLE001
        return None
    return weighted_score(scores, weights, confidence=float(confidence))


def generate_quality_report(
    dataset: dict[str, Any],
    pollution_records: dict[str, Any],
    *,
    weights: dict[str, float] | None = None,
) -> dict[str, Any]:
    generated_at = datetime.now(ZoneInfo('Europe/London')).isoformat(timespec='seconds')
    default_scope = dataset.get('microAreas', [])
    london_scope = dataset.get('londonWideMicroAreas')
    scope_payloads: list[tuple[str, list[dict[str, Any]]]] = [
        ('default', default_scope if isinstance(default_scope, list) else []),
    ]
    if london_scope is not None and isinstance(london_scope, list):
        scope_payloads.append(('londonWide', london_scope))

    issues: list[dict[str, Any]] = []
    pollution_deltas: list[float] = []
    scope_counts: dict[str, int] = {}

    validate_score_source_metadata(issues, dataset)

    for scope_name, micro_areas in scope_payloads:
        if not micro_areas:
            issue(
                issues,
                severity='critical',
                code='dataset_empty',
                message=f'{scope_name} scope micro-area list is empty or invalid.',
                area={'_scope': scope_name},
            )
            scope_counts[scope_name] = 0
            continue

        scope_counts[scope_name] = len(micro_areas)
        seen_micro_ids: set[str] = set()
        seen_station_codes: set[str] = set()
        scoped_rows: list[dict[str, Any]] = []

        for raw_area in micro_areas:
            area = {**raw_area, '_scope': scope_name}
            scoped_rows.append(area)
            micro_area_id = area.get('microAreaId')
            station_code = area.get('stationCode')

            if micro_area_id in seen_micro_ids:
                issue(
                    issues,
                    severity='critical',
                    code='duplicate_micro_area_id',
                    message='Duplicate microAreaId found.',
                    area=area,
                    field='microAreaId',
                    observed=micro_area_id,
                )
            else:
                seen_micro_ids.add(str(micro_area_id))

            if station_code in seen_station_codes:
                issue(
                    issues,
                    severity='warning',
                    code='duplicate_station_code',
                    message='Duplicate stationCode found across micro-areas in the same scope.',
                    area=area,
                    field='stationCode',
                    observed=station_code,
                )
            else:
                seen_station_codes.add(str(station_code))

            if is_finite_number(area.get('overallWeightedScore')):
                check_bounds(
                    issues,
                    area,
                    'overallWeightedScore',
                    float(area['overallWeightedScore']),
                    NUMERIC_BOUNDS['overallWeightedScore'],
                )
            else:
                issue(
                    issues,
                    severity='critical',
                    code='overall_score_non_numeric',
                    message='overallWeightedScore must be numeric.',
                    area=area,
                    field='overallWeightedScore',
                    observed=area.get('overallWeightedScore'),
                )

            for root_field in ('overlapConfidence', 'dataConfidenceScore'):
                value = area.get(root_field)
                if not is_finite_number(value):
                    issue(
                        issues,
                        severity='critical',
                        code='root_metric_non_numeric',
                        message=f'{root_field} must be numeric.',
                        area=area,
                        field=root_field,
                        observed=value,
                    )
                    continue
                check_bounds(issues, area, root_field, float(value), NUMERIC_BOUNDS[root_field])

            validate_components(issues, area)
            for metric_field in METRIC_FIELDS:
                validate_metric_field(issues, area, metric_field)

            pollution_record = pollution_records.get(str(station_code))
            validate_pollution_consistency(issues, area, pollution_record)
            if pollution_record and is_finite_number(pollution_record.get('no2_delta_vs_secondary')):
                pollution_deltas.append(abs(float(pollution_record['no2_delta_vs_secondary'])))

            if weights:
                recomputed = recompute_overall_score(area, weights)
                observed = area.get('overallWeightedScore')
                if recomputed is not None and is_finite_number(observed):
                    if abs(float(observed) - float(recomputed)) > 0.05:
                        issue(
                            issues,
                            severity='critical',
                            code='overall_score_inconsistent',
                            message='overallWeightedScore does not match component scores + default weights.',
                            area=area,
                            field='overallWeightedScore',
                            observed=observed,
                            expected=f'{recomputed:.2f}',
                        )

        validate_ranking_order(issues, scoped_rows)

    counts = {
        'critical': sum(1 for item in issues if item['severity'] == 'critical'),
        'warning': sum(1 for item in issues if item['severity'] == 'warning'),
        'info': sum(1 for item in issues if item['severity'] == 'info'),
    }

    overall_status = 'pass'
    if counts['critical'] > 0:
        overall_status = 'fail'
    elif counts['warning'] > 0:
        overall_status = 'warning'

    pollution_summary = None
    if pollution_deltas:
        sorted_deltas = sorted(pollution_deltas)
        pollution_summary = {
            'londonCrossSourceRows': len(sorted_deltas),
            'medianAbsNo2Delta': round(sorted_deltas[len(sorted_deltas) // 2], 3),
            'p95AbsNo2Delta': round(sorted_deltas[min(len(sorted_deltas) - 1, int(len(sorted_deltas) * 0.95))], 3),
            'maxAbsNo2Delta': round(sorted_deltas[-1], 3),
        }

    report = {
        'generatedAt': generated_at,
        'methodologyVersion': dataset.get('methodologyVersion'),
        'overallStatus': overall_status,
        'microAreasAnalysed': sum(scope_counts.values()),
        'scopeCounts': scope_counts,
        'counts': counts,
        'pollutionCrossSourceSummary': pollution_summary,
        'issues': issues[:800],
        'issuesTruncated': len(issues) > 800,
    }
    return report


def write_quality_report(report: dict[str, Any], output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(report, indent=2, ensure_ascii=True), encoding='utf-8')


def run(
    dataset_path: Path = DATASET_PATH,
    pollution_path: Path = POLLUTION_PATH,
    output_path: Path = REPORT_PATH,
    fail_on_critical: bool = False,
) -> dict[str, Any]:
    dataset = load_json(dataset_path)
    pollution_records = load_json(pollution_path)
    weights = load_default_weights(CONFIG_PATH)
    report = generate_quality_report(dataset, pollution_records, weights=weights)
    write_quality_report(report, output_path)

    if fail_on_critical and report['counts']['critical'] > 0:
        raise RuntimeError(
            f"Dataset quality checks failed with {report['counts']['critical']} critical issues. "
            f'Report: {output_path}',
        )

    return report


def main() -> None:
    parser = argparse.ArgumentParser(description='Validate processed micro-area dataset quality.')
    parser.add_argument('--dataset', type=Path, default=DATASET_PATH)
    parser.add_argument('--pollution', type=Path, default=POLLUTION_PATH)
    parser.add_argument('--output', type=Path, default=REPORT_PATH)
    parser.add_argument(
        '--fail-on-critical',
        action='store_true',
        help='Exit with error when critical data-quality issues are found.',
    )
    args = parser.parse_args()

    report = run(
        dataset_path=args.dataset,
        pollution_path=args.pollution,
        output_path=args.output,
        fail_on_critical=args.fail_on_critical,
    )
    print(f"Data quality report written to {args.output}")
    print(f"Overall status: {report['overallStatus']}")
    print(f"Critical issues: {report['counts']['critical']}")
    print(f"Warnings: {report['counts']['warning']}")


if __name__ == '__main__':
    main()
