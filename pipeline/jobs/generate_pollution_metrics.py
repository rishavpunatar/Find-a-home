from __future__ import annotations

import argparse
import csv
import io
import json
import math
import re
import zipfile
from pathlib import Path
from typing import Any

import requests


ROOT = Path(__file__).resolve().parents[2]
STATIONS_PATH = ROOT / 'data' / 'raw' / 'stations_transport.json'
OUTPUT_PATH = ROOT / 'data' / 'raw' / 'pollution_metrics.json'
LAQM_PAGE = 'https://uk-air.defra.gov.uk/data/laqm-background-maps?year=2021'
LAQM_DATA = 'https://uk-air.defra.gov.uk/data/laqm-background-maps.php?view=data'
LAEI_ZIP_PATH = ROOT / 'data' / 'external' / 'LAEI2019-Concentrations-Data-CSV.zip'
LAEI_NO2_MEMBER = 'LAEI2019-Concentrations-Data-CSV/laei_LAEI2019v3_CorNOx15_NO2.csv'
LAEI_PM25_MEMBER = 'LAEI2019-Concentrations-Data-CSV/laei_LAEI2019v3_CorNOx15_PM25.csv'
LAEI_YEAR = 2019
CATCHMENT_RADIUS_M = 800
GRID_CELL_HALF_DIAGONAL_M = 707


def load_stations(path: Path) -> list[dict[str, Any]]:
    return json.loads(path.read_text(encoding='utf-8'))


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


def as_int(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    if isinstance(value, str):
        stripped = value.strip()
        if not stripped:
            return None
        try:
            return int(float(stripped))
        except ValueError:
            return None
    return None


def build_station_contexts(
    stations: list[dict[str, Any]],
    session: requests.Session,
) -> dict[str, dict[str, Any] | None]:
    context_by_station: dict[str, dict[str, Any] | None] = {}
    context_cache: dict[tuple[float, float], dict[str, Any] | None] = {}

    for station in stations:
        station_code = str(station['station_code'])
        lat = float(station['lat'])
        lon = float(station['lon'])
        cache_key = (round(lat, 5), round(lon, 5))

        if cache_key not in context_cache:
            try:
                context_cache[cache_key] = station_context(lat, lon, session)
            except requests.RequestException:
                context_cache[cache_key] = None

        context_by_station[station_code] = context_cache[cache_key]

    return context_by_station


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


def fetch_laqm_region_grid(region: str, pollutant: str, year: int) -> list[tuple[int, int, float]]:
    response = requests.get(
        LAQM_DATA,
        params={
            'bkgrd-region': region,
            'bkgrd-pollutant': pollutant,
            'bkgrd-year': str(year),
            'action': 'data',
            'year': '2021',
            'submit': 'Download CSV',
        },
        timeout=90,
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
        raise ValueError(f'Unable to locate CSV header for region {region} {pollutant} {year}')

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


def catchment_weighted_value(easting: int, northing: int, grid_rows: list[tuple[int, int, float]]) -> float | None:
    if not grid_rows:
        return None

    inclusion_radius = CATCHMENT_RADIUS_M + GRID_CELL_HALF_DIAGONAL_M
    selected: list[tuple[float, float]] = []

    for grid_x, grid_y, value in grid_rows:
        distance = ((grid_x - easting) ** 2 + (grid_y - northing) ** 2) ** 0.5
        if distance <= inclusion_radius:
            selected.append((distance, value))

    if not selected:
        return nearest_grid_value(easting, northing, grid_rows)

    weighted_sum = 0.0
    total_weight = 0.0
    for distance, value in selected:
        weight = 1.0 / (max(distance, 200.0) ** 1.3)
        weighted_sum += value * weight
        total_weight += weight

    if total_weight == 0:
        return None

    return weighted_sum / total_weight


def load_laei_catchment_values(
    zip_path: Path,
    member_name: str,
    station_points: list[tuple[str, int, int]],
) -> dict[str, float]:
    if not station_points:
        return {}

    radius_sq = CATCHMENT_RADIUS_M * CATCHMENT_RADIUS_M
    bin_size = 1000

    bins: dict[tuple[int, int], list[int]] = {}
    for idx, (_, easting, northing) in enumerate(station_points):
        key = (easting // bin_size, northing // bin_size)
        bins.setdefault(key, []).append(idx)

    weighted_sum: dict[str, float] = {code: 0.0 for code, _, _ in station_points}
    weight_total: dict[str, float] = {code: 0.0 for code, _, _ in station_points}

    with zipfile.ZipFile(zip_path) as zip_file:
        with zip_file.open(member_name) as member_handle:
            stream = io.TextIOWrapper(member_handle, encoding='utf-8')
            reader = csv.DictReader(stream)

            for row in reader:
                x = as_int(row.get('x'))
                y = as_int(row.get('y'))
                if x is None or y is None:
                    continue

                try:
                    concentration = float(row.get('conc', ''))
                except ValueError:
                    continue

                base_x = x // bin_size
                base_y = y // bin_size
                candidates: set[int] = set()
                for delta_x in (-1, 0, 1):
                    for delta_y in (-1, 0, 1):
                        candidates.update(bins.get((base_x + delta_x, base_y + delta_y), []))

                for idx in candidates:
                    station_code, station_easting, station_northing = station_points[idx]
                    distance_sq = (x - station_easting) ** 2 + (y - station_northing) ** 2
                    if distance_sq > radius_sq:
                        continue

                    distance = distance_sq**0.5
                    weight = 1.0 / (max(distance, 20.0) ** 1.2)
                    weighted_sum[station_code] += concentration * weight
                    weight_total[station_code] += weight

    output: dict[str, float] = {}
    for station_code, _, _ in station_points:
        total = weight_total.get(station_code, 0.0)
        if total > 0:
            output[station_code] = weighted_sum[station_code] / total

    return output


def compute_london_laei_metrics(
    stations: list[dict[str, Any]],
    station_contexts: dict[str, dict[str, Any] | None],
) -> dict[str, dict[str, Any]]:
    if not LAEI_ZIP_PATH.exists():
        return {}

    london_points: list[tuple[str, int, int]] = []
    for station in stations:
        if str(station.get('county_or_borough') or '') != 'Greater London':
            continue

        station_code = str(station['station_code'])
        context = station_contexts.get(station_code)
        if not context:
            continue

        easting = as_int(context.get('eastings'))
        northing = as_int(context.get('northings'))
        if easting is None or northing is None:
            continue

        london_points.append((station_code, easting, northing))

    no2_values = load_laei_catchment_values(LAEI_ZIP_PATH, LAEI_NO2_MEMBER, london_points)
    pm25_values = load_laei_catchment_values(LAEI_ZIP_PATH, LAEI_PM25_MEMBER, london_points)

    output: dict[str, dict[str, Any]] = {}
    for station_code, _, _ in london_points:
        if station_code not in no2_values or station_code not in pm25_values:
            continue

        output[station_code] = {
            'annual_no2': round(no2_values[station_code], 5),
            'annual_pm25': round(pm25_values[station_code], 5),
            'status': 'available',
            'confidence': 0.93,
            'methodology_note': (
                f'LAEI {LAEI_YEAR} modelled concentration maps (20m grid); station-centred 800m catchment '
                'value from distance-weighted cells. This London estimate supersedes DEFRA 1km background data.'
            ),
        }

    return output


def generate_pollution_metrics(year: int) -> dict[str, dict[str, Any]]:
    stations = load_stations(STATIONS_PATH)
    authority_codes = fetch_authority_codes()
    session = requests.Session()

    station_contexts = build_station_contexts(stations, session)
    london_laei_metrics = compute_london_laei_metrics(stations, station_contexts)

    no2_cache: dict[str, list[tuple[int, int, float]]] = {}
    pm25_cache: dict[str, list[tuple[int, int, float]]] = {}
    region_no2_cache: dict[str, list[tuple[int, int, float]]] = {}
    region_pm25_cache: dict[str, list[tuple[int, int, float]]] = {}

    output: dict[str, dict[str, Any]] = {}

    for station in stations:
        station_code = str(station['station_code'])
        authority_name = str(station.get('local_authority') or '').strip().lower()
        local_authority_code = authority_codes.get(authority_name)
        context = station_contexts.get(station_code)
        county = str(station.get('county_or_borough') or '')
        use_london_region = county == 'Greater London'

        if not local_authority_code and context:
            local_authority_code = (((context.get('codes') or {}).get('admin_district')) or '').strip()

        if station_code in london_laei_metrics:
            enriched = dict(london_laei_metrics[station_code])
            easting = as_int((context or {}).get('eastings'))
            northing = as_int((context or {}).get('northings'))
            if easting is not None and northing is not None:
                if 'Greater_London' not in region_no2_cache:
                    try:
                        region_no2_cache['Greater_London'] = fetch_laqm_region_grid(
                            'Greater_London',
                            'no2',
                            year,
                        )
                    except Exception:
                        region_no2_cache['Greater_London'] = []
                if 'Greater_London' not in region_pm25_cache:
                    try:
                        region_pm25_cache['Greater_London'] = fetch_laqm_region_grid(
                            'Greater_London',
                            'pm25',
                            year,
                        )
                    except Exception:
                        region_pm25_cache['Greater_London'] = []

                defra_no2 = catchment_weighted_value(easting, northing, region_no2_cache['Greater_London'])
                defra_pm25 = catchment_weighted_value(easting, northing, region_pm25_cache['Greater_London'])
                if defra_no2 is not None and defra_pm25 is not None:
                    enriched['secondary_source_no2'] = round(defra_no2, 5)
                    enriched['secondary_source_pm25'] = round(defra_pm25, 5)
                    enriched['secondary_source_name'] = f'DEFRA LAQM {year} 1km background'
                    enriched['no2_delta_vs_secondary'] = round(
                        float(enriched['annual_no2']) - defra_no2,
                        5,
                    )
                    enriched['pm25_delta_vs_secondary'] = round(
                        float(enriched['annual_pm25']) - defra_pm25,
                        5,
                    )
                    enriched['methodology_note'] = (
                        f"{enriched['methodology_note']} Cross-check vs DEFRA LAQM {year} 1km background: "
                        f'NO2 {defra_no2:.2f}, PM2.5 {defra_pm25:.2f} ug/m3.'
                    )

            output[station_code] = enriched
            continue

        if not local_authority_code:
            continue

        if not context:
            continue
        easting = as_int(context.get('eastings'))
        northing = as_int(context.get('northings'))
        if easting is None or northing is None:
            continue

        if use_london_region:
            if 'Greater_London' not in region_no2_cache:
                try:
                    region_no2_cache['Greater_London'] = fetch_laqm_region_grid('Greater_London', 'no2', year)
                except Exception:
                    region_no2_cache['Greater_London'] = []
            if 'Greater_London' not in region_pm25_cache:
                try:
                    region_pm25_cache['Greater_London'] = fetch_laqm_region_grid('Greater_London', 'pm25', year)
                except Exception:
                    region_pm25_cache['Greater_London'] = []
            no2_grid = region_no2_cache['Greater_London']
            pm25_grid = region_pm25_cache['Greater_London']
            methodology_scope = 'Greater London regional grid'
        else:
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
            no2_grid = no2_cache[local_authority_code]
            pm25_grid = pm25_cache[local_authority_code]
            methodology_scope = f'local authority {local_authority_code}'

        no2_value = catchment_weighted_value(easting, northing, no2_grid)
        pm25_value = catchment_weighted_value(easting, northing, pm25_grid)
        if no2_value is None or pm25_value is None:
            continue

        output[station_code] = {
            'annual_no2': round(no2_value, 5),
            'annual_pm25': round(pm25_value, 5),
            'status': 'available',
            'confidence': 0.88,
            'methodology_note': (
                f'DEFRA LAQM background maps ({year}); station-centred 800m catchment value from '
                f'distance-weighted 1km grid cells in {methodology_scope}.'
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
                'Estimated by inverse-distance interpolation from nearest station pollution records '
                f'({year} run), because no direct LAEI/DEFRA grid match was available for this station.'
            ),
        }

    return output


def main() -> None:
    parser = argparse.ArgumentParser(
        description='Generate pollution metrics using LAEI 20m London concentrations where available and DEFRA LAQM fallback.',
    )
    parser.add_argument('--year', type=int, default=2023, help='Pollution map year to extract.')
    args = parser.parse_args()

    generated = generate_pollution_metrics(args.year)
    OUTPUT_PATH.write_text(json.dumps(generated, indent=2, ensure_ascii=True), encoding='utf-8')
    print(f'Wrote {len(generated)} station pollution records -> {OUTPUT_PATH}')


if __name__ == '__main__':
    main()
