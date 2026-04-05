from __future__ import annotations

from pathlib import Path
from typing import Any

from pipeline.adapters.base import RoadAdapter
from pipeline.adapters.json_loader import JsonFixtureLoader


class FixtureRoadAdapter(RoadAdapter):
    def __init__(self, fixture_path: Path):
        self.data: dict[str, Any] = JsonFixtureLoader(fixture_path).read()

    def get_by_station(self, station_code: str) -> dict[str, Any] | None:
        return self.data.get(station_code)
