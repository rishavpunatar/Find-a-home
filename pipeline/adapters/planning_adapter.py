from __future__ import annotations

from pathlib import Path
from typing import Any

from pipeline.adapters.base import PlanningAdapter
from pipeline.adapters.json_loader import JsonFixtureLoader


class FixturePlanningAdapter(PlanningAdapter):
    def __init__(self, fixture_path: Path):
        self.data: dict[str, Any] = JsonFixtureLoader(fixture_path).read()

    def get_by_station(self, station_code: str) -> dict[str, Any] | None:
        record = self.data.get(station_code)

        if record is None:
            return {
                'planning_risk_score': None,
                'status': 'placeholder',
                'confidence': 0.2,
                'provenance': 'heuristic',
                'methodology_note': (
                    'No structured planning feed connected yet. Placeholder retained for score-model continuity.'
                ),
            }

        return record
