from __future__ import annotations

import argparse
import csv
import io
import json
import math
import re
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Any
from urllib.parse import urljoin

import requests
from pyproj import Transformer


ROOT = Path(__file__).resolve().parents[2]
STATIONS_PATH = ROOT / 'data' / 'raw' / 'stations_transport.json'
OUTPUT_PATH = ROOT / 'data' / 'raw' / 'pollution_metrics.json'
SOURCE_METADATA_PATH = ROOT / 'data' / 'raw' / 'source_metadata.json'
PCM_PAGE_URL = 'https://uk-air.defra.gov.uk/data/pcm-data'
PCM_BASE_URL = 'https://uk-air.defra.gov.uk/data/'
CATCHMENT_RADIUS_M = 800
GRID_CELL_HALF_DIAGONAL_M = 707
GRID_BIN_SIZE_M = 1_000
REQUEST_TIMEOUT_SECONDS = 90
USER_AGENT = 'find-a-home-pipeline/1.0 (+https://github.com/rishavpunatar/Find-a-home)'
WGS84_TO_OSGB = Transformer.from_crs('EPSG:4326', 'EPSG:27700', always_xy=True)


def load_stations(path: Path) -> list[dict[str, Any]]:
    return json.loads(path.read_text(encoding='utf-8'))


def load_json(path: Path) -> Any:
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding='utf-8'))


def write_json(path: Path, payload: Any) -> None:
    path.write_text(f'{json.dumps(payload, indent=2)}\n', encoding='utf-8')


def haversine_distance_m(lat_1: float, lon_1: float, lat_2: float, lon_2: float) -> float:
    radius_m = 6_371_000
    lat_1_rad = math.radians(lat_1)
    lon_1_rad = math.radians(lon_1)
    lat_2_rad = math.radians(lat_2)
    lon_2_rad = math.radians(lon_2)

    d_lat = lat_2_rad - lat_1_rad
    d_lon = lon_2_rad - lon_1_rad

    h = math.sin(d_lat / 2) ** 2 + math.cos(lat_1_rad) * math.cos(lat_2_rad) * math.sin(d_lon / 2) ** 2
    return radius_m * 2 * math.asin(math.sqrt(h))


def build_grid_index(
    grid_rows: list[tuple[int, int, float]],
) -> dict[tuple[int, int], list[tuple[int, int, float]]]:
    index: dict[tuple[int, int], list[tuple[int, int, float]]] = {}
    for x, y, value in grid_rows:
        index.setdefault((x // GRID_BIN_SIZE_M, y // GRID_BIN_SIZE_M), []).append((x, y, value))
    return index


def nearby_grid_rows(
    easting: int,
    northing: int,
    grid_index: dict[tuple[int, int], list[tuple[int, int, float]]],
    *,
    bin_radius: int,
) -> list[tuple[int, int, float]]:
    base_x = easting // GRID_BIN_SIZE_M
    base_y = northing // GRID_BIN_SIZE_M
    rows: list[tuple[int, int, float]] = []
    for delta_x in range(-bin_radius, bin_radius + 1):
        for delta_y in range(-bin_radius, bin_radius + 1):
            rows.extend(grid_index.get((base_x + delta_x, base_y + delta_y), []))
    return rows


def nearest_grid_value(
    easting: int,
    northing: int,
    grid_index: dict[tuple[int, int], list[tuple[int, int, float]]],
) -> float | None:
    if not grid_index:
        return None

    for bin_radius in range(0, 8):
        candidates = nearby_grid_rows(easting, northing, grid_index, bin_radius=bin_radius)
        if not candidates:
            continue

        best_value = None
        best_distance = None
        for grid_x, grid_y, value in candidates:
            distance_sq = (grid_x - easting) ** 2 + (grid_y - northing) ** 2
            if best_distance is None or distance_sq < best_distance:
                best_distance = distance_sq
                best_value = value

        if best_value is not None:
            return best_value

    return None


def catchment_weighted_value(
    easting: int,
    northing: int,
    grid_index: dict[tuple[int, int], list[tuple[int, int, float]]],
) -> float | None:
    if not grid_index:
        return None

    inclusion_radius = CATCHMENT_RADIUS_M + GRID_CELL_HALF_DIAGONAL_M
    search_bins = math.ceil(inclusion_radius / GRID_BIN_SIZE_M) + 1
    selected: list[tuple[float, float]] = []

    for grid_x, grid_y, value in nearby_grid_rows(
        easting,
        northing,
        grid_index,
        bin_radius=search_bins,
    ):
        distance = ((grid_x - easting) ** 2 + (grid_y - northing) ** 2) ** 0.5
        if distance <= inclusion_radius:
            selected.append((distance, value))

    if not selected:
        return nearest_grid_value(easting, northing, grid_index)

    weighted_sum = 0.0
    total_weight = 0.0
    for distance, value in selected:
        weight = 1.0 / (max(distance, 200.0) ** 1.3)
        weighted_sum += value * weight
        total_weight += weight

    if total_weight == 0:
        return None

    return weighted_sum / total_weight


def pcm_link_code(pollutant: str, year: int) -> str:
    if pollutant == 'no2':
        return f'mapno2{year}.csv'
    if pollutant == 'pm25':
        return f'mappm25{year}g.csv'
    raise ValueError(f'Unsupported pollutant {pollutant}')


def pcm_value_column(pollutant: str, year: int) -> str:
    if pollutant == 'no2':
        return f'no2{year}'
    if pollutant == 'pm25':
        return f'pm25{year}g'
    raise ValueError(f'Unsupported pollutant {pollutant}')


def fetch_pcm_download_url(pollutant: str, year: int) -> str:
    response = requests.get(
        PCM_PAGE_URL,
        headers={'User-Agent': USER_AGENT},
        timeout=REQUEST_TIMEOUT_SECONDS,
    )
    response.raise_for_status()

    filename = pcm_link_code(pollutant, year)
    match = re.search(rf'href="([^"]*{re.escape(filename)})"', response.text)
    if not match:
        raise RuntimeError(f'Could not find DEFRA PCM download link for {pollutant} {year}')

    return urljoin(PCM_BASE_URL, match.group(1))


def fetch_pcm_grid(pollutant: str, year: int) -> tuple[list[tuple[int, int, float]], str]:
    download_url = fetch_pcm_download_url(pollutant, year)
    response = requests.get(
        download_url,
        headers={'User-Agent': USER_AGENT},
        timeout=REQUEST_TIMEOUT_SECONDS,
    )
    response.raise_for_status()

    last_modified = response.headers.get('last-modified')
    release_date = (
        parsedate_to_datetime(last_modified).date().isoformat()
        if last_modified
        else f'{year}-01-01'
    )

    header_index = None
    lines = response.text.splitlines()
    for idx, line in enumerate(lines):
        if line.startswith('gridcode,'):
            header_index = idx
            break

    if header_index is None:
        raise RuntimeError(f'Could not locate DEFRA PCM CSV header for {pollutant} {year}')

    value_key = pcm_value_column(pollutant, year)
    csv_payload = '\n'.join(lines[header_index:])
    reader = csv.DictReader(io.StringIO(csv_payload))

    rows: list[tuple[int, int, float]] = []
    for row in reader:
        x = row.get('x')
        y = row.get('y')
        value = row.get(value_key)
        if not x or not y or not value or value == 'MISSING':
            continue
        try:
            rows.append((int(float(x)), int(float(y)), float(value)))
        except ValueError:
            continue

    if not rows:
        raise RuntimeError(f'No usable DEFRA PCM rows parsed for {pollutant} {year}')

    return rows, release_date


def refresh_source_metadata(*, year: int, release_date: str) -> None:
    source_metadata = load_json(SOURCE_METADATA_PATH)
    source_metadata['pollution'] = {
        'source': 'DEFRA UK-AIR modelled background pollution data (PCM)',
        'referencePeriod': f'DEFRA PCM {year} annual mean NO2 and PM2.5 1km grids',
        'releaseDate': release_date,
    }
    write_json(SOURCE_METADATA_PATH, source_metadata)


def generate_pollution_metrics(year: int) -> dict[str, dict[str, Any]]:
    stations = load_stations(STATIONS_PATH)
    no2_grid, no2_release_date = fetch_pcm_grid('no2', year)
    pm25_grid, pm25_release_date = fetch_pcm_grid('pm25', year)
    no2_grid_index = build_grid_index(no2_grid)
    pm25_grid_index = build_grid_index(pm25_grid)
    release_date = max(no2_release_date, pm25_release_date)

    output: dict[str, dict[str, Any]] = {}

    for station in stations:
        station_code = str(station['station_code'])
        easting, northing = WGS84_TO_OSGB.transform(float(station['lon']), float(station['lat']))
        easting_int = int(round(easting))
        northing_int = int(round(northing))

        no2_value = catchment_weighted_value(easting_int, northing_int, no2_grid_index)
        pm25_value = catchment_weighted_value(easting_int, northing_int, pm25_grid_index)

        if no2_value is None or pm25_value is None:
            continue

        output[station_code] = {
            'annual_no2': round(no2_value, 5),
            'annual_pm25': round(pm25_value, 5),
            'status': 'available',
            'confidence': 0.9,
            'methodology_note': (
                f'DEFRA UK-AIR modelled background pollution data ({year}); station-centred 800m catchment '
                'value from distance-weighted 1km grid cells.'
            ),
        }

    station_lookup = {str(station['station_code']): station for station in stations}
    missing_codes = [code for code in station_lookup if code not in output]

    for station_code in missing_codes:
        target = station_lookup[station_code]
        lat = float(target['lat'])
        lon = float(target['lon'])

        candidates: list[tuple[float, dict[str, Any]]] = []
        for anchor_code, record in output.items():
            anchor_station = station_lookup.get(anchor_code)
            if not anchor_station:
                continue
            distance_m = haversine_distance_m(
                lat,
                lon,
                float(anchor_station['lat']),
                float(anchor_station['lon']),
            )
            candidates.append((distance_m, record))

        candidates.sort(key=lambda item: item[0])
        top = candidates[:10]
        if not top:
            continue

        weighted_no2 = 0.0
        weighted_pm25 = 0.0
        weight_total = 0.0
        for distance_m, record in top:
            weight = 1.0 / (max(distance_m, 120.0) ** 1.8)
            weighted_no2 += float(record['annual_no2']) * weight
            weighted_pm25 += float(record['annual_pm25']) * weight
            weight_total += weight

        if weight_total <= 0:
            continue

        nearest_km = top[0][0] / 1000.0
        confidence = max(0.3, min(0.72, 0.72 - 0.018 * nearest_km))
        output[station_code] = {
            'annual_no2': round(weighted_no2 / weight_total, 5),
            'annual_pm25': round(weighted_pm25 / weight_total, 5),
            'status': 'estimated',
            'confidence': round(confidence, 3),
            'methodology_note': (
                'Estimated by inverse-distance interpolation from nearest station DEFRA PCM pollution records '
                f'({year} run), because no direct 1km grid match was available for this station.'
            ),
        }

    refresh_source_metadata(year=year, release_date=release_date)
    return output


def main() -> None:
    parser = argparse.ArgumentParser(
        description='Generate pollution metrics using DEFRA PCM modelled background grids.',
    )
    parser.add_argument('--year', type=int, default=2024, help='DEFRA PCM map year to extract.')
    args = parser.parse_args()

    generated = generate_pollution_metrics(args.year)
    write_json(OUTPUT_PATH, generated)
    print(f'Wrote {len(generated)} station pollution records -> {OUTPUT_PATH}')


if __name__ == '__main__':
    main()
