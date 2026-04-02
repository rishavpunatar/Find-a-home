from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any

from pyproj import Transformer
from shapely.geometry import Point, Polygon
from shapely.ops import transform, unary_union
from shapely.strtree import STRtree

from pipeline.jobs.osrm_utils import fetch_json_with_curl_fallback
from pipeline.jobs.station_scope import candidate_scope_stations


ROOT = Path(__file__).resolve().parents[2]
OUTPUT_PATH = ROOT / 'data' / 'raw' / 'green_space_metrics.json'
SOURCE_METADATA_PATH = ROOT / 'data' / 'raw' / 'source_metadata.json'
OVERPASS_URL = 'https://overpass-api.de/api/interpreter'

GREENSPACE_QUERY = """
[out:json][timeout:240];
(
  way["leisure"="park"]({south},{west},{north},{east});
  relation["leisure"="park"]({south},{west},{north},{east});
  way["leisure"="nature_reserve"]({south},{west},{north},{east});
  relation["leisure"="nature_reserve"]({south},{west},{north},{east});
  way["landuse"="recreation_ground"]({south},{west},{north},{east});
  relation["landuse"="recreation_ground"]({south},{west},{north},{east});
  way["landuse"="village_green"]({south},{west},{north},{east});
  relation["landuse"="village_green"]({south},{west},{north},{east});
);
out geom;
"""

AREA_BUFFER_METERS = 1000.0
GREEN_COVER_BUFFER_METERS = 1600.0
BBOX_MARGIN_DEGREES = 0.04
WGS84_TO_OSGB = Transformer.from_crs('EPSG:4326', 'EPSG:27700', always_xy=True)


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding='utf-8'))


def write_json(path: Path, payload: Any) -> None:
    path.write_text(f'{json.dumps(payload, indent=2)}\n', encoding='utf-8')


def update_source_metadata(reference_period: str, release_date: str) -> None:
    payload: dict[str, Any] = {}
    if SOURCE_METADATA_PATH.exists():
        existing = json.loads(SOURCE_METADATA_PATH.read_text(encoding='utf-8'))
        if isinstance(existing, dict):
            payload = existing

    payload['greenSpace'] = {
        'source': 'OpenStreetMap greenspace polygons via Overpass API',
        'referencePeriod': reference_period,
        'releaseDate': release_date,
    }
    write_json(SOURCE_METADATA_PATH, payload)


def study_bbox(station_latlons: list[tuple[float, float]]) -> tuple[float, float, float, float]:
    lats = [lat for lat, _lon in station_latlons]
    lons = [lon for _lat, lon in station_latlons]
    return (
        min(lats) - BBOX_MARGIN_DEGREES,
        min(lons) - BBOX_MARGIN_DEGREES,
        max(lats) + BBOX_MARGIN_DEGREES,
        max(lons) + BBOX_MARGIN_DEGREES,
    )


def fetch_greenspace_elements(south: float, west: float, north: float, east: float) -> list[dict[str, Any]]:
    query = GREENSPACE_QUERY.format(south=south, west=west, north=north, east=east)
    payload = fetch_json_with_curl_fallback(
        OVERPASS_URL,
        method='POST',
        data=query,
        timeout_seconds=300,
        cache_namespace='overpass-greenspace',
        cache_ttl_hours=24 * 14,
    )
    if not isinstance(payload, dict):
        return []
    elements = payload.get('elements')
    return elements if isinstance(elements, list) else []


def project_to_osgb(geometry: Polygon) -> Polygon:
    return transform(WGS84_TO_OSGB.transform, geometry)


def polygon_from_element(element: dict[str, Any]) -> Polygon | None:
    geometry = element.get('geometry')
    if not isinstance(geometry, list) or len(geometry) < 4:
        return None

    coordinates = []
    for point in geometry:
        lat = (point or {}).get('lat')
        lon = (point or {}).get('lon')
        if not isinstance(lat, (int, float)) or not isinstance(lon, (int, float)):
            return None
        coordinates.append((float(lon), float(lat)))

    if coordinates[0] != coordinates[-1]:
        coordinates.append(coordinates[0])

    polygon = Polygon(coordinates)
    if not polygon.is_valid:
        polygon = polygon.buffer(0)
    if polygon.is_empty or polygon.area == 0:
        return None

    projected = project_to_osgb(polygon)
    if projected.is_empty or projected.area <= 0:
        return None
    return projected


def build_green_geometries(elements: list[dict[str, Any]]) -> list[Polygon]:
    geometries: list[Polygon] = []
    seen: set[tuple[str, int]] = set()
    for element in elements:
        element_type = str(element.get('type', ''))
        element_id = element.get('id')
        if not isinstance(element_id, int):
            continue
        key = (element_type, element_id)
        if key in seen:
            continue
        seen.add(key)
        polygon = polygon_from_element(element)
        if polygon is not None:
            geometries.append(polygon)
    return geometries


def station_green_record(
    point: Point,
    tree: STRtree,
    geometries: list[Polygon],
) -> dict[str, Any]:
    buffer_1km = point.buffer(AREA_BUFFER_METERS)
    green_cover_buffer = point.buffer(GREEN_COVER_BUFFER_METERS)
    nearby_indexes = tree.query(green_cover_buffer)
    nearby_geometries = [geometries[index] for index in nearby_indexes]

    if nearby_geometries:
        greenspace_union = unary_union(nearby_geometries)
        greenspace_area_m2 = float(greenspace_union.intersection(buffer_1km).area)
        green_cover_area_m2 = float(greenspace_union.intersection(green_cover_buffer).area)
    else:
        greenspace_area_m2 = 0.0
        green_cover_area_m2 = 0.0

    nearest_index = tree.nearest(point)
    nearest_geometry = None if nearest_index is None else geometries[int(nearest_index)]
    nearest_distance = None if nearest_geometry is None else float(point.distance(nearest_geometry))
    green_cover_pct = (
        (green_cover_area_m2 / float(green_cover_buffer.area)) * 100.0 if green_cover_buffer.area else 0.0
    )

    return {
        'green_space_area_km2_within_1km': round(greenspace_area_m2 / 1_000_000.0, 3),
        'green_cover_pct': round(green_cover_pct, 3),
        'nearest_park_distance_m': None if nearest_distance is None else round(nearest_distance, 1),
        'status': 'available',
        'confidence': 0.82,
        'provenance': 'direct',
        'methodology_note': (
            'Direct greenspace geometry calculation from OpenStreetMap polygons pulled via the Overpass API. '
            'Greenspace set includes parks, nature reserves, recreation grounds, and village greens. '
            'Area is measured as intersecting greenspace within a 1km station buffer, green cover is measured within '
            'a wider 1600m buffer (2x the default 800m catchment radius), and nearest park distance is measured from '
            'the station centroid to the nearest mapped greenspace boundary.'
        ),
    }


def generate_green_space_metrics() -> dict[str, dict[str, Any]]:
    stations = candidate_scope_stations()
    station_latlons = [(station.coordinate.lat, station.coordinate.lon) for station in stations]
    south, west, north, east = study_bbox(station_latlons)
    elements = fetch_greenspace_elements(south, west, north, east)
    geometries = build_green_geometries(elements)
    if not geometries:
        raise RuntimeError('No greenspace geometries returned from Overpass query')

    tree = STRtree(geometries)
    output: dict[str, dict[str, Any]] = {}
    for station in stations:
        x, y = WGS84_TO_OSGB.transform(station.coordinate.lon, station.coordinate.lat)
        output[station.station_code] = station_green_record(Point(x, y), tree, geometries)

    today = datetime.now().date().isoformat()
    update_source_metadata(
        reference_period='Current OpenStreetMap greenspace snapshot via Overpass API station-scope pull',
        release_date=today,
    )
    return output


def main() -> None:
    payload = generate_green_space_metrics()
    write_json(OUTPUT_PATH, payload)
    print(f'Generated greenspace metrics for {len(payload)} stations -> {OUTPUT_PATH}')


if __name__ == '__main__':
    main()
