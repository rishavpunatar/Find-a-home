from __future__ import annotations

from typing import Iterable


def clamp(value: float, minimum: float = 0.0, maximum: float = 100.0) -> float:
    return max(minimum, min(maximum, value))


def inverse_score(value: float, best: float, worst: float) -> float:
    if worst <= best:
        return 50.0
    scaled = (worst - value) / (worst - best)
    return clamp(scaled * 100)


def forward_score(value: float, min_value: float, max_value: float) -> float:
    if max_value <= min_value:
        return 50.0
    scaled = (value - min_value) / (max_value - min_value)
    return clamp(scaled * 100)


def normalize_weights(raw_weights: dict[str, float]) -> dict[str, float]:
    positive = {key: max(0.0, value) for key, value in raw_weights.items()}
    total = sum(positive.values())

    if total <= 0:
        return raw_weights

    return {key: value * 100 / total for key, value in positive.items()}


def weighted_score(scores: dict[str, float], weights: dict[str, float], confidence: float) -> float:
    normalized = normalize_weights(weights)
    raw = sum(clamp(scores.get(key, 0.0)) * normalized.get(key, 0.0) for key in normalized) / 100
    confidence_factor = 0.8 + clamp(confidence, 0.0, 1.0) * 0.2
    return round(raw * confidence_factor, 2)


def mean(values: Iterable[float]) -> float:
    values_list = list(values)
    if not values_list:
        return 0.0
    return sum(values_list) / len(values_list)
