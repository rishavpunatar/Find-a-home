from __future__ import annotations

import csv
import io
import json
import math
import re
import subprocess
import time
import zipfile
from pathlib import Path
from statistics import mean
from typing import Any
from urllib.parse import urljoin

import requests
from pyproj import Geod, Transformer

from pipeline.jobs.osrm_utils import fetch_json_with_curl_fallback
from pipeline.jobs.station_scope import candidate_scope_stations


ROOT = Path(__file__).resolve().parents[2]
OUTPUT_PATH = ROOT / 'data' / 'raw' / 'crime_metrics.json'
SOURCE_METADATA_PATH = ROOT / 'data' / 'raw' / 'source_metadata.json'
POPULATION_PATH = ROOT / 'data' / 'raw' / 'population_metrics.json'
CRIME_DATES_URL = 'https://data.police.uk/api/crimes-street-dates'
CRIME_DOWNLOAD_PAGE_URL = 'https://data.police.uk/data/'
CRIME_ARCHIVE_URL_TEMPLATE = 'https://data.police.uk/data/archive/{archive_month}.zip'
CRIME_ARCHIVE_CACHE_DIR = ROOT / 'data' / 'cache' / 'police-archive'

BUFFER_METERS = 800.0
GRID_CELL_METERS = BUFFER_METERS
MIN_CRIME_MONTH = '2023-01'
CUSTOM_DOWNLOAD_MIN_MONTH = '2023-02'
CUSTOM_DOWNLOAD_FORCE_SLUGS = (
    'btp',
    'city-of-london',
    'essex',
    'hertfordshire',
    'kent',
    'metropolitan',
    'surrey',
    'thames-valley',
)
CUSTOM_DOWNLOAD_POLL_SECONDS = 10
CUSTOM_DOWNLOAD_TIMEOUT_SECONDS = 60 * 15
GEOD = Geod(ellps='WGS84')
WGS84_TO_OSGB = Transformer.from_crs('EPSG:4326', 'EPSG:27700', always_xy=True)

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
        'source': (
            'data.police.uk monthly street-level crime archive '
            '(BTP, City of London, Metropolitan, and London-boundary forces) '
            '+ interpolated station population denominator'
        ),
        'referencePeriod': reference_period,
        'releaseDate': release_date,
    }
    write_json(SOURCE_METADATA_PATH, payload)


def fetch_available_months() -> list[str]:
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
    eligible_months = [month for month in months if month >= MIN_CRIME_MONTH]
    if not eligible_months:
        raise RuntimeError(f'No crime month history returned from data.police.uk at or after {MIN_CRIME_MONTH}')
    return eligible_months


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


def station_population_denominators(
    stations: list[Any],
    population_records: dict[str, dict[str, Any]],
) -> dict[str, float]:
    denominators: dict[str, float] = {}
    for station in stations:
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
        denominators[station.station_code] = population
    return denominators


def archive_path_for_month(archive_month: str) -> Path:
    return CRIME_ARCHIVE_CACHE_DIR / f'{archive_month}.zip'


def download_full_archive(archive_month: str) -> Path:
    archive_path = archive_path_for_month(archive_month)
    if archive_path.exists() and archive_path.stat().st_size > 100_000_000:
        return archive_path

    archive_path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = archive_path.with_suffix('.tmp')
    if temp_path.exists():
        temp_path.unlink()

    url = CRIME_ARCHIVE_URL_TEMPLATE.format(archive_month=archive_month)
    try:
        with requests.get(url, stream=True, timeout=(30, 600)) as response:
            response.raise_for_status()
            with temp_path.open('wb') as handle:
                for chunk in response.iter_content(chunk_size=1024 * 1024):
                    if chunk:
                        handle.write(chunk)
    except Exception:
        command = [
            'curl',
            '-L',
            '--fail',
            '--silent',
            '--show-error',
            '-o',
            str(temp_path),
            url,
        ]
        subprocess.run(command, check=True)

    temp_path.replace(archive_path)
    return archive_path


def curl_text(
    url: str,
    *,
    cookies_path: Path | None = None,
    referer: str | None = None,
    headers_only: bool = False,
    post_fields: list[tuple[str, str]] | None = None,
) -> str:
    command = ['curl', '-sS', '--fail']
    if cookies_path is not None:
        command.extend(['-b', str(cookies_path), '-c', str(cookies_path)])
    if referer:
        command.extend(['-e', referer])
    if headers_only:
        command.extend(['-D', '-', '-o', '/dev/null'])
    if post_fields:
        command.extend(['-X', 'POST'])
        for key, value in post_fields:
            command.extend(['--data-urlencode', f'{key}={value}'])
    command.append(url)
    result = subprocess.run(command, check=True, capture_output=True, text=True)
    return result.stdout


def parse_csrf_token(html: str) -> str:
    match = re.search(r"name='csrfmiddlewaretoken' value='([^']+)'", html)
    if not match:
        raise RuntimeError('Could not parse CSRF token from data.police.uk download page')
    return match.group(1)


def submit_custom_download(
    *,
    date_from: str,
    date_to: str,
    force_slugs: tuple[str, ...],
    cookies_path: Path,
) -> str:
    page_html = curl_text(CRIME_DOWNLOAD_PAGE_URL, cookies_path=cookies_path)
    csrf_token = parse_csrf_token(page_html)
    post_fields = [
        ('csrfmiddlewaretoken', csrf_token),
        ('date_from', date_from),
        ('date_to', date_to),
        ('include_crime', 'on'),
    ]
    post_fields.extend([('forces', slug) for slug in force_slugs])
    headers = curl_text(
        CRIME_DOWNLOAD_PAGE_URL,
        cookies_path=cookies_path,
        referer=CRIME_DOWNLOAD_PAGE_URL,
        headers_only=True,
        post_fields=post_fields,
    )
    location = None
    for line in headers.splitlines():
        if line.lower().startswith('location:'):
            location = line.split(':', 1)[1].strip()
            break
    if not location:
        raise RuntimeError('data.police.uk custom download did not return a fetch location')
    return urljoin(CRIME_DOWNLOAD_PAGE_URL, location)


def progress_url_for_fetch(fetch_url: str) -> str:
    match = re.search(r'/data/fetch/([0-9a-f-]+)/', fetch_url)
    if not match:
        raise RuntimeError(f'Unexpected fetch URL format: {fetch_url}')
    return urljoin(CRIME_DOWNLOAD_PAGE_URL, f'/data/progress/{match.group(1)}/')


def wait_for_custom_download(fetch_url: str) -> str:
    progress_url = progress_url_for_fetch(fetch_url)
    deadline = time.time() + CUSTOM_DOWNLOAD_TIMEOUT_SECONDS
    last_status = None
    while time.time() < deadline:
        payload = json.loads(curl_text(progress_url))
        status = str(payload.get('status') or '')
        download_url = str(payload.get('url') or '')
        if status != last_status:
            print(f'Crime custom download status: {status or "unknown"}', flush=True)
            last_status = status
        if download_url:
            return urljoin(CRIME_DOWNLOAD_PAGE_URL, download_url)
        time.sleep(CUSTOM_DOWNLOAD_POLL_SECONDS)
    raise RuntimeError('Timed out waiting for data.police.uk custom download to finish')


def custom_archive_cache_path(date_from: str, date_to: str, force_slugs: tuple[str, ...]) -> Path:
    force_key = '-'.join(force_slugs)
    return CRIME_ARCHIVE_CACHE_DIR / f'custom-{date_from}-to-{date_to}-{force_key}.zip'


def download_custom_archive(available_months: list[str]) -> Path:
    eligible_months = [month for month in available_months if month >= CUSTOM_DOWNLOAD_MIN_MONTH]
    if not eligible_months:
        raise RuntimeError(
            f'No months available for custom police archive download at or after {CUSTOM_DOWNLOAD_MIN_MONTH}'
        )
    date_from = eligible_months[-1]
    date_to = eligible_months[0]
    archive_path = custom_archive_cache_path(date_from, date_to, CUSTOM_DOWNLOAD_FORCE_SLUGS)
    if archive_path.exists() and archive_path.stat().st_size > 10_000_000:
        return archive_path

    archive_path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = archive_path.with_suffix('.tmp')
    cookies_path = archive_path.with_suffix('.cookies.txt')

    fetch_url = submit_custom_download(
        date_from=date_from,
        date_to=date_to,
        force_slugs=CUSTOM_DOWNLOAD_FORCE_SLUGS,
        cookies_path=cookies_path,
    )
    print(
        'Requested custom crime archive from data.police.uk for '
        f'{date_from} to {date_to} across {", ".join(CUSTOM_DOWNLOAD_FORCE_SLUGS)}.',
        flush=True,
    )
    download_url = wait_for_custom_download(fetch_url)
    print(f'Crime custom download ready: {download_url}', flush=True)
    subprocess.run(
        [
            'curl',
            '-L',
            '--fail',
            '--silent',
            '--show-error',
            '-C',
            '-',
            '-o',
            str(temp_path),
            download_url,
        ],
        check=True,
    )
    temp_path.replace(archive_path)
    if cookies_path.exists():
        cookies_path.unlink()
    return archive_path


def download_archive(available_months: list[str]) -> Path:
    latest_month = available_months[0]
    try:
        return download_custom_archive(available_months)
    except Exception as error:
        print(
            'Custom crime archive request failed; falling back to full police archive '
            f'for {latest_month}: {error}',
            flush=True,
        )
        return download_full_archive(latest_month)


def archive_month_from_entry(filename: str) -> str | None:
    top_level = filename.split('/', 1)[0]
    return top_level if len(top_level) == 7 and top_level[4] == '-' else None


def eligible_street_entries(
    archive_path: Path,
    eligible_months: set[str],
) -> tuple[list[zipfile.ZipInfo], list[str]]:
    with zipfile.ZipFile(archive_path) as archive:
        entries = [
            entry
            for entry in archive.infolist()
            if entry.filename.endswith('-street.csv')
            and archive_month_from_entry(entry.filename) in eligible_months
        ]

    months = sorted(
        {
            month
            for entry in entries
            if (month := archive_month_from_entry(entry.filename)) is not None
        }
    )
    if not entries or not months:
        raise RuntimeError(f'No eligible street-level crime CSVs found in archive {archive_path.name}')
    return entries, months


def normalize_csv_category(raw_category: str | None) -> str:
    return (raw_category or '').strip().lower().replace(' ', '-')


def bucket_for_category(raw_category: str | None) -> str:
    category = normalize_csv_category(raw_category)
    if category in VIOLENCE_CATEGORIES:
        return 'violence'
    if category in THEFT_CATEGORIES:
        return 'theft'
    if category in VEHICLE_CATEGORIES:
        return 'vehicle'
    return 'other'


def grid_cell(x: float, y: float) -> tuple[int, int]:
    return (math.floor(x / GRID_CELL_METERS), math.floor(y / GRID_CELL_METERS))


def build_station_grid(stations: list[Any]) -> tuple[list[str], list[tuple[float, float]], dict[tuple[int, int], list[int]]]:
    station_codes: list[str] = []
    station_points: list[tuple[float, float]] = []
    grid: dict[tuple[int, int], list[int]] = {}

    for station in stations:
        x, y = WGS84_TO_OSGB.transform(station.coordinate.lon, station.coordinate.lat)
        index = len(station_codes)
        station_codes.append(station.station_code)
        station_points.append((x, y))
        grid.setdefault(grid_cell(x, y), []).append(index)

    return station_codes, station_points, grid


def nearby_station_indexes(
    x: float,
    y: float,
    station_points: list[tuple[float, float]],
    grid: dict[tuple[int, int], list[int]],
) -> list[int]:
    cell_x, cell_y = grid_cell(x, y)
    candidates: list[int] = []
    seen: set[int] = set()
    for offset_x in (-1, 0, 1):
        for offset_y in (-1, 0, 1):
            for index in grid.get((cell_x + offset_x, cell_y + offset_y), []):
                if index in seen:
                    continue
                seen.add(index)
                station_x, station_y = station_points[index]
                if ((station_x - x) ** 2) + ((station_y - y) ** 2) <= BUFFER_METERS**2:
                    candidates.append(index)
    return candidates


def aggregate_archive_counts(
    archive_path: Path,
    entries: list[zipfile.ZipInfo],
    months: list[str],
    station_codes: list[str],
    station_points: list[tuple[float, float]],
    grid: dict[tuple[int, int], list[int]],
) -> tuple[dict[str, dict[str, int]], dict[str, dict[str, int]]]:
    monthly_counts = {code: {month: 0 for month in months} for code in station_codes}
    bucket_totals = {
        code: {'violence': 0, 'theft': 0, 'vehicle': 0, 'other': 0}
        for code in station_codes
    }

    total_rows = 0
    matched_rows = 0
    with zipfile.ZipFile(archive_path) as archive:
        for entry_index, entry in enumerate(entries, start=1):
            month = archive_month_from_entry(entry.filename)
            if month is None:
                continue

            entry_rows = 0
            entry_matches = 0
            with archive.open(entry, 'r') as handle:
                reader = csv.DictReader(io.TextIOWrapper(handle, encoding='utf-8-sig', newline=''))
                for row in reader:
                    entry_rows += 1
                    lat_raw = row.get('Latitude')
                    lon_raw = row.get('Longitude')
                    if not lat_raw or not lon_raw:
                        continue

                    try:
                        lon = float(lon_raw)
                        lat = float(lat_raw)
                    except ValueError:
                        continue

                    x, y = WGS84_TO_OSGB.transform(lon, lat)
                    candidate_indexes = nearby_station_indexes(x, y, station_points, grid)
                    if not candidate_indexes:
                        continue

                    bucket = bucket_for_category(row.get('Crime type'))
                    for candidate_index in candidate_indexes:
                        station_code = station_codes[candidate_index]
                        monthly_counts[station_code][month] += 1
                        bucket_totals[station_code][bucket] += 1
                    entry_matches += 1

            total_rows += entry_rows
            matched_rows += entry_matches
            print(
                'Processed '
                f'{entry_index}/{len(entries)} crime archive files '
                f'({month}, {entry_rows:,} rows, {entry_matches:,} matched station-neighbourhood rows; '
                f'cumulative {total_rows:,}/{matched_rows:,}).',
                flush=True,
            )

    return monthly_counts, bucket_totals


def annualised_breakdown(monthly_counts: list[int], bucket_totals: dict[str, int], population: float) -> tuple[float, dict[str, float]]:
    annualised_rate = (mean(monthly_counts) * 12.0 * 1000.0) / population
    total = sum(bucket_totals.values())
    if total <= 0:
        return annualised_rate, {'violence': 0.0, 'theft': 0.0, 'vehicle': 0.0, 'other': 0.0}

    return annualised_rate, {
        key: round((value / total) * annualised_rate, 1)
        for key, value in bucket_totals.items()
    }


def build_station_crime_records(
    stations: list[Any],
    months: list[str],
    population_denominators: dict[str, float],
    monthly_counts: dict[str, dict[str, int]],
    bucket_totals: dict[str, dict[str, int]],
) -> dict[str, dict[str, Any]]:
    output: dict[str, dict[str, Any]] = {}
    for station in stations:
        population = population_denominators[station.station_code]
        station_month_counts = [monthly_counts[station.station_code][month] for month in months]
        annualised_rate, breakdown = annualised_breakdown(
            station_month_counts,
            bucket_totals[station.station_code],
            population,
        )
        output[station.station_code] = {
            'crime_rate_per_1000': round(annualised_rate, 3),
            'status': 'available',
            'confidence': 0.8,
            'provenance': 'direct',
            'breakdown': breakdown,
            'methodology_note': (
                'Direct monthly street-level crime archive aggregation from data.police.uk for all currently '
                f'available months since {MIN_CRIME_MONTH} within an 800m station radius, using the official '
                'archive download for BTP, City of London, Metropolitan, and London-boundary forces. '
                'Counts are averaged into an annualised per-1,000 rate using the station reference-zone '
                'population denominator (direct when present, otherwise nearest-anchor interpolation).'
            ),
        }
    return output


def generate_crime_metrics() -> dict[str, dict[str, Any]]:
    stations = candidate_scope_stations()
    available_months = fetch_available_months()
    latest_month = available_months[0]
    archive_path = download_archive(available_months)
    entries, archive_months = eligible_street_entries(archive_path, set(available_months))
    population_records = read_json(POPULATION_PATH)
    population_denominators = station_population_denominators(stations, population_records)
    station_codes, station_points, grid = build_station_grid(stations)
    monthly_counts, bucket_totals = aggregate_archive_counts(
        archive_path,
        entries,
        archive_months,
        station_codes,
        station_points,
        grid,
    )
    output = build_station_crime_records(
        stations,
        archive_months,
        population_denominators,
        monthly_counts,
        bucket_totals,
    )

    update_source_metadata(
        reference_period=(
            f'All currently available data.police.uk archive months from {archive_months[0]} to {archive_months[-1]} '
            f'({len(archive_months)} monthly snapshots) averaged and annualised'
        ),
        release_date=latest_month,
    )
    return output


def main() -> None:
    payload = generate_crime_metrics()
    write_json(OUTPUT_PATH, payload)
    print(f'Generated crime metrics for {len(payload)} stations -> {OUTPUT_PATH}')


if __name__ == '__main__':
    main()
