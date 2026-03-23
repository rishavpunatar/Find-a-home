from pipeline.jobs.verify_data_sources import rank_values, source_matrix, spearman_rank_correlation


def test_rank_values_handles_ties() -> None:
    ranks = rank_values([10, 20, 20, 40])
    assert ranks[0] == 1.0
    assert ranks[1] == 2.5
    assert ranks[2] == 2.5
    assert ranks[3] == 4.0


def test_spearman_rank_correlation_is_high_for_monotonic_series() -> None:
    correlation = spearman_rank_correlation([1, 2, 3, 4], [10, 20, 30, 40])
    assert correlation is not None
    assert correlation > 0.99


def test_source_matrix_contains_required_domains() -> None:
    matrix = source_matrix()
    required = {
        'property',
        'transport',
        'schools',
        'pollution',
        'greenSpace',
        'crime',
        'population',
        'planning',
    }
    assert required.issubset(set(matrix.keys()))
