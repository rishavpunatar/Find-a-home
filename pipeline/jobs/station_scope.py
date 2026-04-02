from __future__ import annotations

import json
from pathlib import Path

from pipeline.adapters.station_transport_adapter import FixtureStationTransportAdapter
from pipeline.jobs.build_micro_areas import (
    candidate_filter,
    dedupe_micro_areas,
    load_config,
    sanitize_station_universe,
)
from pipeline.models.entities import StationRecord


ROOT = Path(__file__).resolve().parents[2]
RAW_DIR = ROOT / 'data' / 'raw'
STATIONS_PATH = RAW_DIR / 'stations_transport.json'
TRANSPORT_METRICS_PATH = RAW_DIR / 'transport_metrics.json'
CONFIG_PATH = ROOT / 'pipeline' / 'config' / 'search_config.json'


def candidate_scope_stations() -> list[StationRecord]:
    config = load_config(CONFIG_PATH)
    raw_stations = FixtureStationTransportAdapter(STATIONS_PATH).fetch_stations()
    all_stations, _excluded = sanitize_station_universe(raw_stations)
    transport_records = json.loads(TRANSPORT_METRICS_PATH.read_text(encoding='utf-8'))

    scoped_stations = candidate_filter(all_stations, config, transport_records)
    return dedupe_micro_areas(scoped_stations, config.station_distance_threshold_m)


def candidate_scope_station_codes() -> set[str]:
    return {station.station_code for station in candidate_scope_stations()}
