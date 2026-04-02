from __future__ import annotations

import io
import json
import math
import sqlite3
import zipfile
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import requests
from pyproj import Transformer
from shapely import wkb
from shapely.geometry import Point
from shapely.ops import unary_union
from shapely.strtree import STRtree

from pipeline.jobs.station_scope import candidate_scope_stations


ROOT = Path(__file__).resolve().parents[2]
OUTPUT_PATH = ROOT / 'data' / 'raw' / 'green_space_metrics.json'
SOURCE_METADATA_PATH = ROOT / 'data' / 'raw' / 'source_metadata.json'
CACHE_DIR = ROOT / 'data' / 'cache' / 'os-open-greenspace'

OS_OPEN_GREENSPACE_META_URL = (
    'https://api.os.uk/downloads/v1/products/OpenGreenspace/downloads?area=GB&format=GeoPackage'
)
OS_GREENSPACE_TABLE = 'greenspace_site'
OS_ACCESS_TABLE = 'access_point'

AREA_BUFFER_METERS = 1000.0
GREEN_COVER_BUFFER_METERS = 1600.0
STUDY_MARGIN_METERS = GREEN_COVER_BUFFER_METERS + 500.0
WGS84_TO_OSGB = Transformer.from_crs('EPSG:4326', 'EPSG:27700', always_xy=True)


def write_json(path: Path, payload: Any) -> None:
    path.write_text(f'{json.dumps(payload, indent=2)}\n', encoding='utf-8')


def update_source_metadata(reference_period: str, release_date: str) -> None:
    payload: dict[str, Any] = {}
    if SOURCE_METADATA_PATH.exists():
        existing = json.loads(SOURCE_METADATA_PATH.read_text(encoding='utf-8'))
        if isinstance(existing, dict):
            payload = existing

    payload['greenSpace'] = {
        'source': 'Ordnance Survey OS Open Greenspace GeoPackage',
        'referencePeriod': reference_period,
        'releaseDate': release_date,
    }
    write_json(SOURCE_METADATA_PATH, payload)


def greenspace_archive_path(file_name: str) -> Path:
    return CACHE_DIR / file_name


def geopackage_path() -> Path:
    return CACHE_DIR / 'opgrsp_gb.gpkg'


def download_os_open_greenspace_archive() -> Path:
    meta = requests.get(OS_OPEN_GREENSPACE_META_URL, timeout=30).json()
    if not isinstance(meta, list) or not meta:
        raise RuntimeError('OS Open Greenspace metadata response was empty')
    archive_meta = meta[0]
    download_url = f"{archive_meta['url']}&redirect=true"
    archive_path = greenspace_archive_path(str(archive_meta.get('fileName') or 'opgrsp_gpkg_gb.zip'))
    expected_size = int(archive_meta.get('size') or 0)
    if archive_path.exists() and archive_path.stat().st_size == expected_size:
        return archive_path

    archive_path.parent.mkdir(parents=True, exist_ok=True)
    response = requests.get(download_url, timeout=180)
    response.raise_for_status()
    archive_path.write_bytes(response.content)
    return archive_path


def ensure_geopackage() -> Path:
    gpkg_path = geopackage_path()
    if gpkg_path.exists():
        return gpkg_path

    archive_path = download_os_open_greenspace_archive()
    with zipfile.ZipFile(archive_path) as archive:
        gpkg_member = next((name for name in archive.namelist() if name.endswith('.gpkg')), None)
        if not gpkg_member:
            raise RuntimeError('OS Open Greenspace archive did not contain a GeoPackage')
        gpkg_path.parent.mkdir(parents=True, exist_ok=True)
        gpkg_path.write_bytes(archive.read(gpkg_member))
    return gpkg_path


def gpkg_blob_to_geometry(blob: bytes) -> Any:
    if blob[:2] != b'GP':
        raise ValueError('Unexpected GeoPackage geometry header')
    flags = blob[3]
    envelope_indicator = (flags >> 1) & 0b111
    envelope_length = {
        0: 0,
        1: 32,
        2: 48,
        3: 48,
        4: 64,
    }.get(envelope_indicator, 0)
    header_length = 8 + envelope_length
    return wkb.loads(blob[header_length:])


def study_bbox_osgb() -> tuple[float, float, float, float]:
    xs: list[float] = []
    ys: list[float] = []
    for station in candidate_scope_stations():
        x, y = WGS84_TO_OSGB.transform(station.coordinate.lon, station.coordinate.lat)
        xs.append(float(x))
        ys.append(float(y))
    return (
        min(xs) - STUDY_MARGIN_METERS,
        min(ys) - STUDY_MARGIN_METERS,
        max(xs) + STUDY_MARGIN_METERS,
        max(ys) + STUDY_MARGIN_METERS,
    )


def query_table_rows(
    connection: sqlite3.Connection,
    *,
    table_name: str,
    bbox: tuple[float, float, float, float],
    columns: list[str],
) -> list[sqlite3.Row]:
    min_x, min_y, max_x, max_y = bbox
    rtree_name = f'rtree_{table_name}_geometry'
    select_columns = ', '.join(columns)
    query = f'''
        SELECT {select_columns}
        FROM {table_name}
        JOIN {rtree_name}
          ON {table_name}.fid = {rtree_name}.id
        WHERE {rtree_name}.maxx >= ?
          AND {rtree_name}.minx <= ?
          AND {rtree_name}.maxy >= ?
          AND {rtree_name}.miny <= ?
    '''
    cursor = connection.execute(query, (min_x, max_x, min_y, max_y))
    return cursor.fetchall()


def load_study_greenspace(connection: sqlite3.Connection) -> tuple[list[Any], list[Point]]:
    bbox = study_bbox_osgb()
    greenspace_rows = query_table_rows(
        connection,
        table_name=OS_GREENSPACE_TABLE,
        bbox=bbox,
        columns=['greenspace_site.geometry'],
    )
    access_rows = query_table_rows(
        connection,
        table_name=OS_ACCESS_TABLE,
        bbox=bbox,
        columns=['access_point.geometry', 'access_point.access_type'],
    )

    site_geometries: list[Any] = []
    for (geometry_blob,) in greenspace_rows:
        if not isinstance(geometry_blob, (bytes, bytearray)):
            continue
        geometry = gpkg_blob_to_geometry(bytes(geometry_blob))
        if geometry.is_empty or geometry.area <= 0:
            continue
        site_geometries.append(geometry)

    access_points: list[Point] = []
    for geometry_blob, access_type in access_rows:
        if not isinstance(geometry_blob, (bytes, bytearray)):
            continue
        normalized_access_type = str(access_type or '').strip().lower()
        if normalized_access_type and 'pedestrian' not in normalized_access_type:
            continue
        geometry = gpkg_blob_to_geometry(bytes(geometry_blob))
        if geometry.is_empty:
            continue
        access_points.append(geometry)

    if not site_geometries:
        raise RuntimeError('No OS Open Greenspace polygons intersected the station study area')

    return site_geometries, access_points


def station_green_record(
    point: Point,
    site_tree: STRtree,
    site_geometries: list[Any],
    access_tree: STRtree | None,
    access_points: list[Point],
) -> dict[str, Any]:
    buffer_1km = point.buffer(AREA_BUFFER_METERS)
    green_cover_buffer = point.buffer(GREEN_COVER_BUFFER_METERS)
    nearby_indexes = site_tree.query(green_cover_buffer)
    nearby_geometries = [site_geometries[int(index)] for index in nearby_indexes]

    if nearby_geometries:
        greenspace_union = unary_union(nearby_geometries)
        greenspace_area_m2 = float(greenspace_union.intersection(buffer_1km).area)
        green_cover_area_m2 = float(greenspace_union.intersection(green_cover_buffer).area)
        nearest_boundary_distance = float(min(point.distance(geometry) for geometry in nearby_geometries))
    else:
        greenspace_area_m2 = 0.0
        green_cover_area_m2 = 0.0
        nearest_boundary_distance = float('inf')

    nearest_access_distance = None
    if access_tree is not None and access_points:
        nearest_index = access_tree.nearest(point)
        if nearest_index is not None:
            nearest_access_distance = float(point.distance(access_points[int(nearest_index)]))

    nearest_distance = (
        nearest_access_distance
        if nearest_access_distance is not None
        else nearest_boundary_distance
        if math.isfinite(nearest_boundary_distance)
        else None
    )
    green_cover_pct = (
        (green_cover_area_m2 / float(green_cover_buffer.area)) * 100.0 if green_cover_buffer.area else 0.0
    )

    return {
        'green_space_area_km2_within_1km': round(greenspace_area_m2 / 1_000_000.0, 3),
        'green_cover_pct': round(green_cover_pct, 3),
        'nearest_park_distance_m': None if nearest_distance is None else round(nearest_distance, 1),
        'status': 'available',
        'confidence': 0.88,
        'provenance': 'direct',
        'methodology_note': (
            'Direct greenspace geometry calculation from Ordnance Survey OS Open Greenspace. '
            'Area is measured as intersecting greenspace within a 1km station buffer, green cover is measured within '
            'a wider 1600m buffer (2x the default 800m catchment radius), and nearest park distance uses the nearest '
            'mapped public access point where available, otherwise the nearest greenspace boundary.'
        ),
    }


def generate_green_space_metrics() -> dict[str, dict[str, Any]]:
    gpkg_path = ensure_geopackage()
    with sqlite3.connect(gpkg_path) as connection:
        site_geometries, access_points = load_study_greenspace(connection)

    site_tree = STRtree(site_geometries)
    access_tree = STRtree(access_points) if access_points else None
    output: dict[str, dict[str, Any]] = {}
    for station in candidate_scope_stations():
        x, y = WGS84_TO_OSGB.transform(station.coordinate.lon, station.coordinate.lat)
        output[station.station_code] = station_green_record(
            Point(x, y),
            site_tree,
            site_geometries,
            access_tree,
            access_points,
        )

    today = datetime.now(ZoneInfo('Europe/London')).date().isoformat()
    update_source_metadata(
        reference_period='Current OS Open Greenspace GB GeoPackage snapshot',
        release_date=today,
    )
    return output


def main() -> None:
    payload = generate_green_space_metrics()
    write_json(OUTPUT_PATH, payload)
    print(f'Generated greenspace metrics for {len(payload)} stations -> {OUTPUT_PATH}')


if __name__ == '__main__':
    main()
