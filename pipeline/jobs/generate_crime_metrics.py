from __future__ import annotations

import json
import math
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from statistics import mean
from typing import Any

from pyproj import Geod

from pipeline.jobs.osrm_utils import fetch_json_with_curl_fallback
from pipeline.jobs.station_scope import candidate_scope_stations


ROOT = Path(__file__).resolve().parents[2]
OUTPUT_PATH = ROOT / 'data' / 'raw' / 'crime_metrics.json'
SOURCE_METADATA_PATH = ROOT / 'data' / 'raw' / 'source_metadata.json'
POPULATION_PATH = ROOT / 'data' / 'raw' / 'population_metrics.json'
CRIME_DATES_URL = 'https://data.police.uk/api/crimes-street-dates'
CRIME_POLY_URL = 'https://data.police.uk/api/crimes-street/all-crime'

BUFFER_METERS = 800.0
POLYGON_SIDES = 16
MONTH_COUNT = 3
GEOD = Geod(ellps='WGS84')

VIOLENCE_CATEGORIES = {
    'violence-and-sexual-offences',
}
THEFT_CATEGORIES = {
    'burglary',
    'bicycle-theft',
    'other-theft',
    'robbery',
    'shoplifting',
    'theft-from-the-person',
}
VEHICLE_CATEGORIES = {
    'vehicle-crime',
}


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

    payload['crime'] = {
        'source': 'data.police.uk custom-area street-level crime pulls + interpolated station population denominator',
        'referencePeriod': reference_period,
        'releaseDate': release_date,
    }
    write_json(SOURCE_METADATA_PATH, payload)


def fetch_latest_months() -> list[str]:
    payload = fetch_json_with_curl_fallback(
        CRIME_DATES_URL,
        timeout_seconds=30,
        cache_namespace='police-crime-dates',
        cache_ttl_hours=24 * 10,
    )
    if not isinstance(payload, list):
        raise RuntimeError('Unable to fetch latest crime dates payload')
    months = sorted(
        [
            str(item.get('date'))
            for item in payload
            if isinstance(item, dict) and isinstance(item.get('date'), str)
        ],
        reverse=True,
    )
    if len(months) < MONTH_COUNT:
        raise RuntimeError('Insufficient crime month history returned from data.police.uk')
    return months[:MONTH_COUNT]


def circle_polygon_param(lat: float, lon: float, radius_m: float, sides: int = POLYGON_SIDES) -> str:
    points: list[str] = []
    for idx in range(sides):
        bearing = (360.0 / sides) * idx
        dest_lon, dest_lat, _back = GEOD.fwd(lon, lat, bearing, radius_m)
        points.append(f'{dest_lat:.6f},{dest_lon:.6f}')
    return ':'.join(points)


def annualised_breakdown(monthly_payloads: list[list[dict[str, Any]]], population: float) -> tuple[float, dict[str, float]]:
    monthly_counts = [len(payload) for payload in monthly_payloads]
    annualised_rate = (mean(monthly_counts) * 12.0 * 1000.0) / population

    bucket_totals = {'violence': 0, 'theft': 0, 'vehicle': 0, 'other': 0}
    for payload in monthly_payloads:
        for crime in payload:
            category = str(crime.get('category') or '')
            if category in VIOLENCE_CATEGORIES:
                bucket_totals['violence'] += 1
            elif category in THEFT_CATEGORIES:
                bucket_totals['theft'] += 1
            elif category in VEHICLE_CATEGORIES:
                bucket_totals['vehicle'] += 1
            else:
                bucket_totals['other'] += 1

    total = sum(bucket_totals.values())
    if total <= 0:
        return annualised_rate, {'violence': 0.0, 'theft': 0.0, 'vehicle': 0.0, 'other': 0.0}

    return annualised_rate, {
        key: round((value / total) * annualised_rate, 1)
        for key, value in bucket_totals.items()
    }


def nearest_population_estimate(
    station_lat: float,
    station_lon: float,
    stations: list[Any],
    population_records: dict[str, dict[str, Any]],
) -> float | None:
    samples: list[tuple[float, float]] = []
    for station in stations:
        record = population_records.get(station.station_code)
        population = (record or {}).get('population_in_reference_zone')
        if not isinstance(population, (int, float)):
            continue
        distance = GEOD.inv(
            station_lon,
            station_lat,
            station.coordinate.lon,
            station.coordinate.lat,
        )[2]
        samples.append((max(distance, 120.0), float(population)))

    if not samples:
        return None

    samples.sort(key=lambda pair: pair[0])
    nearest = samples[:8]
    weighted_sum = 0.0
    weight_total = 0.0
    for distance_m, population in nearest:
        weight = 1.0 / (distance_m**1.6)
        weighted_sum += population * weight
        weight_total += weight
    return None if weight_total == 0 else weighted_sum / weight_total


def fetch_station_month_payload(poly: str, month: str) -> list[dict[str, Any]]:
    payload = fetch_json_with_curl_fallback(
        CRIME_POLY_URL,
        params={'poly': poly, 'date': month},
        timeout_seconds=60,
        cache_namespace='police-crime-polygons',
        cache_ttl_hours=24 * 31,
    )
    return payload if isinstance(payload, list) else []


def build_station_crime_record(
    station: Any,
    months: list[str],
    population_records: dict[str, dict[str, Any]],
    stations: list[Any],
) -> tuple[str, dict[str, Any]]:
    population_record = population_records.get(station.station_code)
    population = (
        float(population_record['population_in_reference_zone'])
        if population_record and isinstance(population_record.get('population_in_reference_zone'), (int, float))
        else nearest_population_estimate(
            station.coordinate.lat,
            station.coordinate.lon,
            stations,
            population_records,
        )
    )
    if population is None or population <= 0:
        raise RuntimeError(f'No population denominator available for {station.station_code}')

    poly = circle_polygon_param(station.coordinate.lat, station.coordinate.lon, BUFFER_METERS)
    monthly_payloads = [fetch_station_month_payload(poly, month) for month in months]
    annualised_rate, breakdown = annualised_breakdown(monthly_payloads, population)

    return (
        station.station_code,
        {
            'crime_rate_per_1000': round(annualised_rate, 3),
            'status': 'available',
            'confidence': 0.77,
            'provenance': 'direct',
            'breakdown': breakdown,
            'methodology_note': (
                'Direct custom-area street-level crime pulls from data.police.uk for the latest three available months '
                'within an 800m station polygon, annualised to a per-1,000 rate using the station reference-zone '
                'population denominator (direct when present, otherwise nearest-anchor interpolation).'
            ),
        },
    )


def generate_crime_metrics(max_workers: int = 12) -> dict[str, dict[str, Any]]:
    stations = candidate_scope_stations()
    months = fetch_latest_months()
    population_records = read_json(POPULATION_PATH)

    output: dict[str, dict[str, Any]] = {}
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = [
            executor.submit(build_station_crime_record, station, months, population_records, stations)
            for station in stations
        ]
        for idx, future in enumerate(as_completed(futures), start=1):
            station_code, record = future.result()
            output[station_code] = record
            if idx % 50 == 0 or idx == len(futures):
                print(f'Processed crime metrics for {idx}/{len(futures)} stations...', flush=True)

    update_source_metadata(
        reference_period=f'Latest {len(months)} months from data.police.uk ({", ".join(months)}) annualised',
        release_date=months[0],
    )
    return output


def main() -> None:
    payload = generate_crime_metrics()
    write_json(OUTPUT_PATH, payload)
    print(f'Generated crime metrics for {len(payload)} stations -> {OUTPUT_PATH}')


if __name__ == '__main__':
    main()
