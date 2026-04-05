from __future__ import annotations

import json
import math
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import requests
from pyproj import Transformer
from shapely.geometry import LineString, Point
from shapely.strtree import STRtree

from pipeline.jobs.station_scope import candidate_scope_stations


ROOT = Path(__file__).resolve().parents[2]
OUTPUT_PATH = ROOT / 'data' / 'raw' / 'road_metrics.json'
SOURCE_METADATA_PATH = ROOT / 'data' / 'raw' / 'source_metadata.json'
OVERPASS_URL = 'https://overpass-api.de/api/interpreter'
WGS84_TO_OSGB = Transformer.from_crs('EPSG:4326', 'EPSG:27700', always_xy=True)
ROAD_LENGTH_BUFFER_METERS = 1600.0
STUDY_MARGIN_METERS = ROAD_LENGTH_BUFFER_METERS + 1000.0
MAJOR_HIGHWAY_VALUES = (
    'motorway',
    'motorway_link',
    'trunk',
    'trunk_link',
    'primary',
    'primary_link',
    'secondary',
    'secondary_link',
)


def write_json(path: Path, payload: Any) -> None:
    path.write_text(f'{json.dumps(payload, indent=2)}\n', encoding='utf-8')


def update_source_metadata(reference_period: str, release_date: str) -> None:
    payload: dict[str, Any] = {}
    if SOURCE_METADATA_PATH.exists():
        existing = json.loads(SOURCE_METADATA_PATH.read_text(encoding='utf-8'))
        if isinstance(existing, dict):
            payload = existing

    payload['roads'] = {
        'source': 'OpenStreetMap major-road geometry via Overpass API',
        'referencePeriod': reference_period,
        'releaseDate': release_date,
    }
    write_json(SOURCE_METADATA_PATH, payload)


def station_bbox() -> tuple[float, float, float, float]:
    stations = candidate_scope_stations()
    if not stations:
        raise RuntimeError('No candidate-scope stations available for road-metric generation')

    lats = [station.coordinate.lat for station in stations]
    lons = [station.coordinate.lon for station in stations]
    mean_lat = sum(lats) / len(lats)
    lat_margin = STUDY_MARGIN_METERS / 111_320.0
    lon_margin = STUDY_MARGIN_METERS / max(1.0, 111_320.0 * math.cos(math.radians(mean_lat)))
    return (
        min(lats) - lat_margin,
        min(lons) - lon_margin,
        max(lats) + lat_margin,
        max(lons) + lon_margin,
    )


def overpass_query() -> str:
    south, west, north, east = station_bbox()
    highway_pattern = '|'.join(MAJOR_HIGHWAY_VALUES)
    return f"""[out:json][timeout:240];
(
  way["highway"~"^({highway_pattern})$"]({south:.6f},{west:.6f},{north:.6f},{east:.6f});
);
out geom tags;"""


def fetch_major_roads() -> list[LineString]:
    response = requests.post(
        OVERPASS_URL,
        data=overpass_query().encode('utf-8'),
        timeout=300,
    )
    response.raise_for_status()
    payload = response.json()

    roads: list[LineString] = []
    for element in payload.get('elements', []):
        if element.get('type') != 'way':
            continue
        geometry = element.get('geometry')
        if not isinstance(geometry, list) or len(geometry) < 2:
            continue

        coordinates: list[tuple[float, float]] = []
        for node in geometry:
            if not isinstance(node, dict):
                continue
            lat = node.get('lat')
            lon = node.get('lon')
            if not isinstance(lat, (int, float)) or not isinstance(lon, (int, float)):
                continue
            x, y = WGS84_TO_OSGB.transform(float(lon), float(lat))
            coordinates.append((float(x), float(y)))

        if len(coordinates) < 2:
            continue

        line = LineString(coordinates)
        if line.is_empty or line.length <= 0:
            continue
        roads.append(line)

    if not roads:
        raise RuntimeError('No major-road geometry returned from Overpass for the current study bbox')

    return roads


def station_road_record(point: Point, road_tree: STRtree, roads: list[LineString]) -> dict[str, Any]:
    buffer = point.buffer(ROAD_LENGTH_BUFFER_METERS)
    nearby_indexes = road_tree.query(buffer)
    nearby_roads = [roads[int(index)] for index in nearby_indexes]

    intersected_length_m = 0.0
    if nearby_roads:
        intersected_length_m = sum(float(road.intersection(buffer).length) for road in nearby_roads)

    nearest_index = road_tree.nearest(point)
    nearest_distance_m = None
    if nearest_index is not None:
        nearest_distance_m = float(point.distance(roads[int(nearest_index)]))

    return {
        'nearest_main_road_distance_m': (
            None if nearest_distance_m is None else round(nearest_distance_m, 1)
        ),
        'major_road_length_km_within_1600m': round(intersected_length_m / 1000.0, 3),
        'status': 'available',
        'confidence': 0.86,
        'provenance': 'direct',
        'methodology_note': (
            'Direct major-road exposure metrics from current OpenStreetMap highway geometry via Overpass. '
            'Main roads are motorway, trunk, primary, and secondary classes plus their link roads. '
            'The stored metrics are nearest distance from the station centroid to the nearest mapped main road '
            'and total main-road length intersecting a 1600m station buffer (2x the default 800m catchment). '
            'Farther nearest distance and less intersecting main-road length are treated as better in the ranking.'
        ),
    }


def generate_road_metrics() -> dict[str, dict[str, Any]]:
    roads = fetch_major_roads()
    road_tree = STRtree(roads)

    output: dict[str, dict[str, Any]] = {}
    for station in candidate_scope_stations():
        x, y = WGS84_TO_OSGB.transform(station.coordinate.lon, station.coordinate.lat)
        output[station.station_code] = station_road_record(Point(x, y), road_tree, roads)

    today = datetime.now(ZoneInfo('Europe/London')).date().isoformat()
    update_source_metadata(
        reference_period=f'Current OpenStreetMap major-road snapshot via Overpass on {today}',
        release_date=today,
    )
    return output


def main() -> None:
    payload = generate_road_metrics()
    write_json(OUTPUT_PATH, payload)
    print(f'Generated road metrics for {len(payload)} stations -> {OUTPUT_PATH}')


if __name__ == '__main__':
    main()
