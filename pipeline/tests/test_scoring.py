from pipeline.models.scoring import inverse_score, normalize_weights, weighted_score


def test_normalize_weights_sum_to_100() -> None:
    normalized = normalize_weights(
        {
            'transport': 20,
            'schools': 10,
            'environment': 10,
            'crime': 10,
        },
    )

    assert round(sum(normalized.values()), 6) == 100


def test_inverse_score_direction() -> None:
    better = inverse_score(20, best=15, worst=60)
    worse = inverse_score(45, best=15, worst=60)

    assert better > worse


def test_weighted_score_confidence_penalty() -> None:
    scores = {
        'transport': 70,
        'schools': 70,
        'environment': 70,
        'crime': 70,
    }
    weights = {
        'transport': 29,
        'schools': 34,
        'environment': 22,
        'crime': 15,
    }

    assert weighted_score(scores, weights, confidence=1.0) > weighted_score(scores, weights, confidence=0.2)
