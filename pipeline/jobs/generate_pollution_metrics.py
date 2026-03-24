from __future__ import annotations

import argparse
import csv
import io
import json
import re
from pathlib import Path
from typing import Any

import requests


ROOT = Path(__file__).resolve().parents[2]
STATIONS_PATH = ROOT / 'data' / 'raw' / 'stations_transport.json'
OUTPUT_PATH = ROOT / 'data' / 'raw' / 'pollution_metrics.json'
LAQM_PAGE = 'https://uk-air.defra.gov.uk/data/laqm-background-maps?year=2021'
LAQM_DATA = 'https://uk-air.defra.gov.uk/data/laqm-background-maps.php?view=data'


def load_stations(path: Path) -> list[dict[str, Any]]:
    return json.loads(path.read_text(encoding='utf-8'))


def fetch_authority_codes() -> dict[str, str]:
    html = requests.get(LAQM_PAGE, timeout=30).text
    matches = re.findall(r'<option value="([A-Z0-9]+)">([^<]+)</option>', html)
    mapping: dict[str, str] = {}
    for code, name in matches:
        mapping[name.strip().lower()] = code
    return mapping


def station_context(lat: float, lon: float, session: requests.Session) -> dict[str, Any] | None:
    response = session.get(
        'https://api.postcodes.io/postcodes',
        params={'lon': lon, 'lat': lat},
        timeout=15,
    )
    if response.status_code != 200:
        return None

    result = response.json().get('result') or []
    if not result:
        return None

    return result[0]


def fetch_laqm_grid(local_authority_code: str, pollutant: str, year: int) -> list[tuple[int, int, float]]:
    response = requests.get(
        LAQM_DATA,
        params={
            'bkgrd-la': local_authority_code,
            'bkgrd-pollutant': pollutant,
            'bkgrd-year': str(year),
            'action': 'data',
            'year': '2021',
            'submit': 'Download CSV',
        },
        timeout=60,
    )
    response.raise_for_status()
    text = response.text

    header_index = None
    lines = text.splitlines()
    for idx, line in enumerate(lines):
        if line.startswith('Local_Auth_Code,'):
            header_index = idx
            break

    if header_index is None:
        raise ValueError(f'Unable to locate CSV header for LAD {local_authority_code} {pollutant} {year}')

    csv_payload = '\n'.join(lines[header_index:])
    reader = csv.DictReader(io.StringIO(csv_payload))

    value_key = f'Total_NO2_{str(year)[-2:]}' if pollutant == 'no2' else f'Total_PM2.5_{str(year)[-2:]}'

    rows: list[tuple[int, int, float]] = []
    for row in reader:
        x = row.get('x')
        y = row.get('y')
        value = row.get(value_key)
        if not x or not y or not value:
            continue
        try:
            rows.append((int(float(x)), int(float(y)), float(value)))
        except ValueError:
            continue

    return rows


def nearest_grid_value(easting: int, northing: int, grid_rows: list[tuple[int, int, float]]) -> float | None:
    if not grid_rows:
        return None

    best_value = None
    best_distance = None
    for grid_x, grid_y, value in grid_rows:
        distance_sq = (grid_x - easting) ** 2 + (grid_y - northing) ** 2
        if best_distance is None or distance_sq < best_distance:
            best_distance = distance_sq
            best_value = value

    return best_value


def generate_pollution_metrics(year: int) -> dict[str, dict[str, Any]]:
    stations = load_stations(STATIONS_PATH)
    authority_codes = fetch_authority_codes()
    session = requests.Session()

    no2_cache: dict[str, list[tuple[int, int, float]]] = {}
    pm25_cache: dict[str, list[tuple[int, int, float]]] = {}
    context_cache: dict[tuple[float, float], dict[str, Any] | None] = {}

    output: dict[str, dict[str, Any]] = {}

    for station in stations:
        station_code = str(station['station_code'])
        lat = float(station['lat'])
        lon = float(station['lon'])
        authority_name = str(station.get('local_authority') or '').strip().lower()

        local_authority_code = authority_codes.get(authority_name)

        cache_key = (round(lat, 5), round(lon, 5))
        if cache_key not in context_cache:
            try:
                context_cache[cache_key] = station_context(lat, lon, session)
            except requests.RequestException:
                context_cache[cache_key] = None
        context = context_cache[cache_key]

        if not local_authority_code and context:
            local_authority_code = (((context.get('codes') or {}).get('admin_district')) or '').strip()

        if not local_authority_code:
            continue

        if local_authority_code not in no2_cache:
            try:
                no2_cache[local_authority_code] = fetch_laqm_grid(local_authority_code, 'no2', year)
            except Exception:
                no2_cache[local_authority_code] = []

        if local_authority_code not in pm25_cache:
            try:
                pm25_cache[local_authority_code] = fetch_laqm_grid(local_authority_code, 'pm25', year)
            except Exception:
                pm25_cache[local_authority_code] = []

        if not context:
            continue
        easting = context.get('eastings')
        northing = context.get('northings')
        if not isinstance(easting, int) or not isinstance(northing, int):
            continue

        no2_value = nearest_grid_value(easting, northing, no2_cache[local_authority_code])
        pm25_value = nearest_grid_value(easting, northing, pm25_cache[local_authority_code])
        if no2_value is None or pm25_value is None:
            continue

        output[station_code] = {
            'annual_no2': round(no2_value, 5),
            'annual_pm25': round(pm25_value, 5),
            'status': 'available',
            'confidence': 0.9,
            'methodology_note': (
                f'DEFRA LAQM background maps ({year}) mapped from station coordinate to nearest 1km grid '
                f'cell within local authority {local_authority_code}.'
            ),
        }

    return output


def main() -> None:
    parser = argparse.ArgumentParser(description='Generate pollution metrics from DEFRA LAQM background maps.')
    parser.add_argument('--year', type=int, default=2023, help='Pollution map year to extract.')
    args = parser.parse_args()

    generated = generate_pollution_metrics(args.year)
    OUTPUT_PATH.write_text(json.dumps(generated, indent=2, ensure_ascii=True), encoding='utf-8')
    print(f'Wrote {len(generated)} station pollution records -> {OUTPUT_PATH}')


if __name__ == '__main__':
    main()
