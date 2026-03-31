from pipeline.jobs.generate_school_metrics import (
    percentile_quality_scores,
    percentile_rank_map,
    proximity_weighted_quality,
    safe_float,
    weighted_average,
)


def test_safe_float_handles_numeric_and_suppressed_values() -> None:
    assert safe_float('12.4') == 12.4
    assert safe_float('z') is None
    assert safe_float('') is None


def test_percentile_rank_map_orders_values() -> None:
    scores = percentile_rank_map({'a': 10.0, 'b': 20.0, 'c': 30.0})

    assert scores['a'] == 0.0
    assert scores['b'] == 50.0
    assert scores['c'] == 100.0


def test_weighted_average_returns_none_for_empty_input() -> None:
    assert weighted_average([]) is None


def test_percentile_quality_scores_combines_available_metrics() -> None:
    metric_bundle = {
        's1': {'m1': 10.0, 'm2': 10.0},
        's2': {'m1': 20.0, 'm2': 30.0},
        's3': {'m1': 30.0, 'm2': 20.0},
    }

    scores = percentile_quality_scores(metric_bundle, {'m1': 0.7, 'm2': 0.3})

    assert scores['s1'] < scores['s2'] < scores['s3']


def test_proximity_weighted_quality_uses_nearest_supplement_when_radius_too_small() -> None:
    school_records = {
        'near': {'phase': 'Secondary', 'easting': 100.0, 'northing': 0.0},
        'mid': {'phase': 'Secondary', 'easting': 600.0, 'northing': 0.0},
        'far': {'phase': 'Secondary', 'easting': 1200.0, 'northing': 0.0},
    }
    quality_scores = {'near': 80.0, 'mid': 60.0, 'far': 40.0}

    quality = proximity_weighted_quality(
        0.0,
        0.0,
        school_records,
        quality_scores,
        allowed_phases={'Secondary'},
        radius_meters=150.0,
        minimum_inputs=3,
    )

    assert quality is not None
    assert 60.0 < quality < 80.0
