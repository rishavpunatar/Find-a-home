from __future__ import annotations

from copy import deepcopy

from pipeline.jobs.validate_dataset import generate_quality_report
from pipeline.models.scoring import weighted_score


def metric(value: float, note: str = 'LAEI 2019 source') -> dict[str, object]:
    return {
        'value': value,
        'unit': '',
        'status': 'available',
        'confidence': 0.9,
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
        'proximity': 72.0,
        'planningRisk': 63.0,
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
        'annualNo2': metric(31.0, note='LAEI 2019 source with DEFRA cross-check'),
        'annualPm25': metric(11.2),
        'greenSpaceAreaKm2Within1km': metric(0.82),
        'greenCoverPct': metric(29.4),
        'nearestParkDistanceM': metric(210.0),
        'crimeRatePerThousand': metric(62.0),
        'planningRiskHeuristic': metric(44.0),
        'boroughQolScore': metric(72.3),
    }
    return area


def default_weights() -> dict[str, float]:
    return {
        'value': 25,
        'transport': 20,
        'schools': 20,
        'environment': 15,
        'crime': 12.5,
        'proximity': 5,
        'planningRisk': 2.5,
    }


def pollution_record(no2: float = 31.0, pm25: float = 11.2) -> dict[str, object]:
    return {
        'annual_no2': no2,
        'annual_pm25': pm25,
        'status': 'available',
        'confidence': 0.93,
        'methodology_note': 'LAEI based',
        'secondary_source_no2': 19.5,
        'secondary_source_pm25': 8.8,
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
    area['annualNo2'] = metric(180.0, note='LAEI 2019 source with DEFRA cross-check')
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
