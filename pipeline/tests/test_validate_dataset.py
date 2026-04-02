from __future__ import annotations

from copy import deepcopy

from pipeline.jobs.validate_dataset import extract_four_digit_years, generate_quality_report
from pipeline.models.scoring import weighted_score


def metric(value: float, note: str = 'DEFRA PCM 2024 source') -> dict[str, object]:
    return {
        'value': value,
        'unit': '',
        'status': 'available',
        'confidence': 0.9,
        'provenance': 'direct',
        'methodologyNote': note,
        'lastUpdated': '2026-03-24',
    }


def make_area() -> dict[str, object]:
    component_scores = {
        'value': 71.0,
        'transport': 68.0,
        'schools': 70.0,
        'environment': 66.0,
        'crime': 67.0,
    }
    data_confidence = 0.91
    area: dict[str, object] = {
        'microAreaId': 'ma-1',
        'stationCode': 'STA001',
        'stationName': 'Test Station',
        'countyOrBorough': 'Greater London',
        'overallWeightedScore': weighted_score(component_scores, default_weights(), confidence=data_confidence),
        'overlapConfidence': 0.82,
        'dataConfidenceScore': data_confidence,
        'componentScores': component_scores,
        'averageSemiDetachedPrice': metric(540_000),
        'medianSemiDetachedPrice': metric(525_000),
        'semiPriceTrendPct5y': metric(22.5),
        'affordabilityScore': metric(58.0),
        'valueForMoneyScore': metric(64.0),
        'commuteTypicalMinutes': metric(39.0),
        'commutePeakMinutes': metric(44.0),
        'commuteOffPeakMinutes': metric(35.0),
        'serviceFrequencyPeakTph': metric(12.0),
        'interchangeCount': metric(1.0),
        'driveTimeToPinnerMinutes': metric(17.0),
        'nearbyPrimaryCount': metric(6.0),
        'nearbySecondaryCount': metric(4.0),
        'primaryQualityScore': metric(78.0),
        'secondaryQualityScore': metric(74.0),
        'annualNo2': metric(31.0, note='DEFRA PCM 2024 source'),
        'annualPm25': metric(11.2),
        'greenSpaceAreaKm2Within1km': metric(0.82),
        'greenCoverPct': metric(29.4),
        'nearestParkDistanceM': metric(210.0),
        'crimeRatePerThousand': metric(62.0),
        'boroughQolScore': metric(72.3),
    }
    return area


def default_weights() -> dict[str, float]:
    return {
        'value': 32,
        'transport': 20,
        'schools': 23,
        'environment': 15,
        'crime': 10,
    }


def pollution_record(no2: float = 31.0, pm25: float = 11.2) -> dict[str, object]:
    return {
        'annual_no2': no2,
        'annual_pm25': pm25,
        'status': 'available',
        'confidence': 0.93,
        'methodology_note': 'DEFRA PCM based',
    }


def test_generate_quality_report_passes_valid_dataset() -> None:
    dataset = {'methodologyVersion': 'v1', 'microAreas': [make_area()]}
    report = generate_quality_report(
        dataset,
        {'STA001': pollution_record()},
        weights=default_weights(),
    )

    assert report['overallStatus'] == 'pass'
    assert report['counts']['critical'] == 0
    assert report['counts']['warning'] == 0


def test_generate_quality_report_flags_out_of_bounds_metric() -> None:
    area = make_area()
    area['annualNo2'] = metric(180.0, note='DEFRA PCM 2024 source')
    dataset = {'methodologyVersion': 'v1', 'microAreas': [area]}

    report = generate_quality_report(
        dataset,
        {'STA001': pollution_record(no2=180.0)},
        weights=default_weights(),
    )

    assert report['overallStatus'] == 'fail'
    assert report['counts']['critical'] > 0
    assert any(issue['field'] == 'annualNo2' for issue in report['issues'])


def test_generate_quality_report_flags_pollution_mismatch() -> None:
    area = make_area()
    dataset = {'methodologyVersion': 'v1', 'microAreas': [deepcopy(area)]}

    report = generate_quality_report(
        dataset,
        {'STA001': pollution_record(no2=22.0, pm25=8.0)},
        weights=default_weights(),
    )

    assert report['overallStatus'] == 'fail'
    assert any(item['code'] == 'pollution_value_mismatch' for item in report['issues'])


def test_generate_quality_report_flags_pre_2023_scored_source_metadata() -> None:
    dataset = {
        'methodologyVersion': 'v1',
        'microAreas': [make_area()],
        'config': {
            'sourceMetadata': {
                'pollution': {
                    'source': 'Old source',
                    'referencePeriod': 'LAEI 2019 + DEFRA 2023',
                    'releaseDate': '2023-12-31',
                },
            },
        },
    }

    report = generate_quality_report(
        dataset,
        {'STA001': pollution_record()},
        weights=default_weights(),
    )

    assert report['overallStatus'] == 'fail'
    assert any(item['code'] == 'score_source_pre_2023' for item in report['issues'])


def test_extract_four_digit_years_handles_school_academic_years() -> None:
    years = extract_four_digit_years(
        'primary attainment basket from 2023-onward KS2 202324-202425; attendance 202324; Ofsted 2025-08-31'
    )

    assert 2023 in years
    assert 2024 in years
    assert 2025 in years
    assert 2022 not in years


def test_extract_four_digit_years_flags_compact_pre_2023_academic_years() -> None:
    years = extract_four_digit_years('Legacy KS2 202223-202324 results')

    assert 2022 in years
