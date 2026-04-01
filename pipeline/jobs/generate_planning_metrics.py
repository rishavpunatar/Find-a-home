from __future__ import annotations

import json
import math
from datetime import datetime
from pathlib import Path
from typing import Any

from pyproj import Transformer
from shapely import wkt
from shapely.geometry import Point, box
from shapely.ops import transform
from shapely.strtree import STRtree

from pipeline.jobs.osrm_utils import fetch_json_with_curl_fallback
from pipeline.jobs.station_scope import candidate_scope_stations


ROOT = Path(__file__).resolve().parents[2]
OUTPUT_PATH = ROOT / 'data' / 'raw' / 'planning_metrics.json'
SOURCE_METADATA_PATH = ROOT / 'data' / 'raw' / 'source_metadata.json'
ENTITY_URL = 'https://www.planning.data.gov.uk/entity.json'

WGS84_TO_OSGB = Transformer.from_crs('EPSG:4326', 'EPSG:27700', always_xy=True)
BBOX_MARGIN_DEGREES = 0.04
BROWNFIELD_BUFFER_METERS = 1500.0
CONSTRAINT_BUFFER_METERS = 800.0
PAGE_LIMIT = 500


def write_json(path: Path, payload: Any) -> None:
    path.write_text(f'{json.dumps(payload, indent=2)}\n', encoding='utf-8')


def update_source_metadata(reference_period: str, release_date: str) -> None:
    payload: dict[str, Any] = {}
    if SOURCE_METADATA_PATH.exists():
        existing = json.loads(SOURCE_METADATA_PATH.read_text(encoding='utf-8'))
        if isinstance(existing, dict):
            payload = existing

    payload['planning'] = {
        'source': 'planning.data.gov.uk structured geometry layers',
        'referencePeriod': reference_period,
        'releaseDate': release_date,
    }
    write_json(SOURCE_METADATA_PATH, payload)


def study_bbox_polygon(stations: list[Any]):
    min_lat = min(station.coordinate.lat for station in stations) - BBOX_MARGIN_DEGREES
    max_lat = max(station.coordinate.lat for station in stations) + BBOX_MARGIN_DEGREES
    min_lon = min(station.coordinate.lon for station in stations) - BBOX_MARGIN_DEGREES
    max_lon = max(station.coordinate.lon for station in stations) + BBOX_MARGIN_DEGREES
    return box(min_lon, min_lat, max_lon, max_lat)


def fetch_dataset_entities(dataset: str) -> list[dict[str, Any]]:
    offset = 0
    entities: list[dict[str, Any]] = []
    while True:
        payload = fetch_json_with_curl_fallback(
            ENTITY_URL,
            params={'dataset': dataset, 'limit': PAGE_LIMIT, 'offset': offset},
            timeout_seconds=90,
            cache_namespace=f'planning-entities-{dataset}',
            cache_ttl_hours=24 * 14,
        )
        if not isinstance(payload, dict):
            break
        page_entities = payload.get('entities')
        if not isinstance(page_entities, list) or not page_entities:
            break
        entities.extend(page_entities)
        offset += len(page_entities)
        total = payload.get('count')
        if isinstance(total, int) and offset >= total:
            break
    return entities


def to_projected_geometry(entity: dict[str, Any]):
    geometry_wkt = entity.get('geometry')
    point_wkt = entity.get('point')
    raw = geometry_wkt if isinstance(geometry_wkt, str) and geometry_wkt.strip() else point_wkt
    if not isinstance(raw, str) or not raw.strip():
        return None

    geometry = wkt.loads(raw)
    if geometry.is_empty:
        return None
    projected = transform(WGS84_TO_OSGB.transform, geometry)
    if projected.is_empty:
        return None
    return projected


def load_filtered_geometries(
    dataset: str,
    study_bbox,
    *,
    include_attrs: tuple[str, ...] = (),
) -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []
    for entity in fetch_dataset_entities(dataset):
        geometry = to_projected_geometry(entity)
        if geometry is None:
            continue
        geometry_wgs84 = wkt.loads(entity.get('geometry') or entity.get('point'))
        if geometry_wgs84.is_empty or not geometry_wgs84.intersects(study_bbox):
            continue
        record = {'geometry': geometry}
        for attr in include_attrs:
            record[attr] = entity.get(attr)
        output.append(record)
    return output


def parse_float(value: Any) -> float | None:
    if value in (None, ''):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def brownfield_units(record: dict[str, Any]) -> float:
    maximum = parse_float(record.get('maximum-net-dwellings'))
    minimum = parse_float(record.get('minimum-net-dwellings'))
    hectares = parse_float(record.get('hectares'))
    if maximum is not None:
        return maximum
    if minimum is not None:
        return minimum
    if hectares is not None:
        return hectares * 35.0
    return 0.0


def clamp(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(maximum, value))


def build_station_planning_record(
    point: Point,
    brownfield_tree: STRtree,
    brownfield_records: list[dict[str, Any]],
    conservation_tree: STRtree,
    conservation_records: list[dict[str, Any]],
    article4_tree: STRtree,
    article4_records: list[dict[str, Any]],
) -> dict[str, Any]:
    pressure_buffer = point.buffer(BROWNFIELD_BUFFER_METERS)
    constraint_buffer = point.buffer(CONSTRAINT_BUFFER_METERS)

    brownfield_indexes = brownfield_tree.query(pressure_buffer)
    brownfield_sites = [brownfield_records[index] for index in brownfield_indexes]
    weighted_units = 0.0
    weighted_hectares = 0.0
    deliverable_sites = 0
    for record in brownfield_sites:
        geometry = record['geometry']
        distance_m = max(point.distance(geometry), 50.0)
        weight = 1.0 / (1.0 + distance_m / 350.0)
        weighted_units += brownfield_units(record) * weight
        hectares = parse_float(record.get('hectares')) or 0.0
        weighted_hectares += hectares * weight
        if str(record.get('deliverable') or '').lower() == 'yes':
            deliverable_sites += 1

    def weighted_constraint_area(tree: STRtree, records: list[dict[str, Any]], multiplier: float) -> float:
        indexes = tree.query(constraint_buffer)
        total = 0.0
        for index in indexes:
            geometry = records[index]['geometry']
            total += float(geometry.intersection(constraint_buffer).area) * multiplier
        return total

    conservation_area = weighted_constraint_area(conservation_tree, conservation_records, 1.0)
    article4_area = weighted_constraint_area(article4_tree, article4_records, 0.8)
    constraint_pct = (
        ((conservation_area + article4_area) / float(constraint_buffer.area)) * 100.0
        if constraint_buffer.area
        else 0.0
    )
    pressure_score = min(
        100.0,
        18.0 * math.log1p(weighted_units) + 12.0 * math.log1p(weighted_hectares + deliverable_sites),
    )
    site_bonus = min(12.0, deliverable_sites * 2.0)
    planning_risk = clamp(18.0 + pressure_score * 0.72 + site_bonus - constraint_pct * 0.24, 5.0, 95.0)

    return {
        'planning_risk_score': round(planning_risk, 3),
        'status': 'available',
        'confidence': 0.8,
        'provenance': 'direct',
        'methodology_note': (
            'Structured planning score from planning.data.gov.uk geometry layers. '
            'Brownfield land within 1.5km increases development-pressure risk, while conservation-area and '
            'article-4-direction coverage within 800m dampen that risk as planning constraints. '
            'This replaces the prior placeholder heuristic with a rule-based score from authoritative planning layers.'
        ),
    }


def generate_planning_metrics() -> dict[str, dict[str, Any]]:
    stations = candidate_scope_stations()
    study_bbox = study_bbox_polygon(stations)

    brownfield_records = load_filtered_geometries(
        'brownfield-land',
        study_bbox,
        include_attrs=('hectares', 'minimum-net-dwellings', 'maximum-net-dwellings', 'deliverable'),
    )
    conservation_records = load_filtered_geometries('conservation-area', study_bbox)
    article4_records = load_filtered_geometries('article-4-direction-area', study_bbox)

    if not brownfield_records or not conservation_records or not article4_records:
        raise RuntimeError('Planning data pull returned insufficient geometry coverage for one or more datasets')

    brownfield_tree = STRtree([record['geometry'] for record in brownfield_records])
    conservation_tree = STRtree([record['geometry'] for record in conservation_records])
    article4_tree = STRtree([record['geometry'] for record in article4_records])

    output: dict[str, dict[str, Any]] = {}
    for station in stations:
        x, y = WGS84_TO_OSGB.transform(station.coordinate.lon, station.coordinate.lat)
        output[station.station_code] = build_station_planning_record(
            Point(x, y),
            brownfield_tree,
            brownfield_records,
            conservation_tree,
            conservation_records,
            article4_tree,
            article4_records,
        )

    today = datetime.now().date().isoformat()
    update_source_metadata(
        reference_period='Current planning.data.gov.uk geometry pull for brownfield land, conservation areas, and article 4 direction areas',
        release_date=today,
    )
    return output


def main() -> None:
    payload = generate_planning_metrics()
    write_json(OUTPUT_PATH, payload)
    print(f'Generated planning metrics for {len(payload)} stations -> {OUTPUT_PATH}')


if __name__ == '__main__':
    main()
