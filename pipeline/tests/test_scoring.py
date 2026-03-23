from pipeline.models.scoring import inverse_score, normalize_weights, weighted_score


def test_normalize_weights_sum_to_100() -> None:
    normalized = normalize_weights(
        {
            'value': 30,
            'transport': 20,
            'schools': 10,
            'environment': 10,
            'crime': 10,
            'proximity': 10,
            'planningRisk': 10,
        },
    )

    assert round(sum(normalized.values()), 6) == 100


def test_inverse_score_direction() -> None:
    better = inverse_score(20, best=15, worst=60)
    worse = inverse_score(45, best=15, worst=60)

    assert better > worse


def test_weighted_score_confidence_penalty() -> None:
    scores = {
        'value': 70,
        'transport': 70,
        'schools': 70,
        'environment': 70,
        'crime': 70,
        'proximity': 70,
        'planningRisk': 70,
    }
    weights = {
        'value': 25,
        'transport': 20,
        'schools': 20,
        'environment': 15,
        'crime': 12.5,
        'proximity': 5,
        'planningRisk': 2.5,
    }

    assert weighted_score(scores, weights, confidence=1.0) > weighted_score(scores, weights, confidence=0.2)
