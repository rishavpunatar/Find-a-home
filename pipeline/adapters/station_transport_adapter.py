from __future__ import annotations

from pathlib import Path

from pipeline.adapters.base import StationTransportAdapter
from pipeline.adapters.json_loader import JsonFixtureLoader
from pipeline.models.entities import Coordinate, StationRecord


class FixtureStationTransportAdapter(StationTransportAdapter):
    def __init__(self, fixture_path: Path):
        self.loader = JsonFixtureLoader(fixture_path)

    def fetch_stations(self) -> list[StationRecord]:
        records = self.loader.read()
        return [
            StationRecord(
                station_code=record['station_code'],
                station_name=record['station_name'],
                operator=record['operator'],
                lines=record['lines'],
                local_authority=record['local_authority'],
                county_or_borough=record['county_or_borough'],
                coordinate=Coordinate(lat=record['lat'], lon=record['lon']),
                typical_commute_min=record['typical_commute_min'],
                peak_commute_min=record['peak_commute_min'],
                offpeak_commute_min=record['offpeak_commute_min'],
                peak_tph=record['peak_tph'],
                interchange_count=record['interchange_count'],
                drive_to_pinner_min=record['drive_to_pinner_min'],
            )
            for record in records
        ]
