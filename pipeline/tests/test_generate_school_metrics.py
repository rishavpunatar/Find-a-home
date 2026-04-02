from pipeline.jobs.generate_school_metrics import (
    count_drive_catchment_schools,
    drive_time_weighted_quality,
    estimate_drive_minutes_from_distance,
    percentile_quality_scores,
    percentile_rank_map,
    primary_accessibility_weight,
    primary_ofsted_warning_severity,
    safe_float,
    time_period_start_year,
    weighted_average,
)


def test_safe_float_handles_numeric_and_suppressed_values() -> None:
    assert safe_float('12.4') == 12.4
    assert safe_float('z') is None
    assert safe_float('') is None


def test_time_period_start_year_parses_ees_formats() -> None:
    assert time_period_start_year('202223') == 2022
    assert time_period_start_year('2023/24') == 2023
    assert time_period_start_year('2024/25') == 2024


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


def test_estimate_drive_minutes_from_distance_grows_with_distance() -> None:
    assert estimate_drive_minutes_from_distance(0.0) == 3.0
    assert estimate_drive_minutes_from_distance(5_000.0) > estimate_drive_minutes_from_distance(1_000.0)


def test_drive_time_weighted_quality_only_uses_reachable_schools() -> None:
    school_records = {
        'near': {'phase': 'Secondary'},
        'mid': {'phase': 'Secondary'},
        'far': {'phase': 'Secondary'},
    }
    quality_scores = {'near': 80.0, 'mid': 60.0, 'far': 40.0}
    drive_minutes = {'near': 8.0, 'mid': 18.0, 'far': 26.0}

    quality = drive_time_weighted_quality(
        drive_minutes,
        school_records,
        quality_scores,
        allowed_phases={'Secondary'},
    )

    assert quality is not None
    assert 60.0 < quality < 80.0


def test_count_drive_catchment_schools_only_counts_schools_inside_drive_window() -> None:
    school_records = {
        'p1': {'phase': 'Primary'},
        'p2': {'phase': 'Primary'},
        's1': {'phase': 'Secondary'},
    }
    drive_minutes = {'p1': 9.0, 'p2': 24.0, 's1': 14.0}

    assert (
        count_drive_catchment_schools(
            drive_minutes,
            school_records,
            allowed_phases={'Primary'},
        )
        == 1
    )


def test_primary_accessibility_weight_penalizes_faith_and_distance() -> None:
    community_weight = primary_accessibility_weight(
        5.0,
        {
            'phase': 'Primary',
            'admissions_policy': 'Not applicable',
            'religious_character': 'Does not apply',
            'school_capacity': 360,
        },
    )
    faith_weight = primary_accessibility_weight(
        12.0,
        {
            'phase': 'Primary',
            'admissions_policy': 'Not applicable',
            'religious_character': 'Church of England',
            'school_capacity': 180,
        },
    )

    assert community_weight > faith_weight > 0


def test_primary_ofsted_warning_severity_escalates_for_weaker_outcomes() -> None:
    assert (
        primary_ofsted_warning_severity(
            {
                'Overall effectiveness': '2',
                'Quality of education': '2',
                'Behaviour and attitudes': '2',
                'Effectiveness of leadership and management': '2',
                'Safeguarding is effective?': 'Yes',
                'Number of warning notices issued in 2024/25 academic year': '0',
            }
        )
        == 0.0
    )
    assert (
        primary_ofsted_warning_severity(
            {
                'Overall effectiveness': '4',
                'Quality of education': '4',
                'Behaviour and attitudes': '3',
                'Effectiveness of leadership and management': '4',
                'Safeguarding is effective?': 'No',
                'Number of warning notices issued in 2024/25 academic year': '1',
            }
        )
        == 1.0
    )
