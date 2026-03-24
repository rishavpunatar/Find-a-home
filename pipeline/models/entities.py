from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class Coordinate:
    lat: float
    lon: float


@dataclass(frozen=True)
class StationRecord:
    station_code: str
    station_name: str
    operator: str
    lines: list[str]
    local_authority: str
    county_or_borough: str
    coordinate: Coordinate
    typical_commute_min: float
    peak_commute_min: float
    offpeak_commute_min: float
    peak_tph: float
    interchange_count: int
    drive_to_pinner_min: float


@dataclass(frozen=True)
class NumericMetric:
    value: float | None
    unit: str
    status: str
    confidence: float
    methodology_note: str
    last_updated: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "value": self.value,
            "unit": self.unit,
            "status": self.status,
            "confidence": round(max(0.0, min(1.0, self.confidence)), 3),
            "methodologyNote": self.methodology_note,
            "lastUpdated": self.last_updated,
        }


@dataclass(frozen=True)
class SearchConfig:
    methodology_version: str
    generated_timezone: str
    pinner_coordinate: Coordinate
    central_london_coordinate: Coordinate
    station_search_radius_km: float
    micro_area_walk_radius_m: int
    max_commute_minutes: float
    max_drive_minutes_to_pinner: float
    station_distance_threshold_m: float
    destination_station: str
    default_weights: dict[str, float]
    last_updated_default: str
