from __future__ import annotations

import argparse
import json
import statistics
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import requests


ROOT = Path(__file__).resolve().parents[2]
STATIONS_PATH = ROOT / 'data' / 'raw' / 'stations_transport.json'
OUTPUT_PATH = ROOT / 'data' / 'raw' / 'transport_metrics.json'

PINNER_LAT = 51.5931
PINNER_LON = -0.3818
OXFORD_CIRCUS_LAT = 51.5152
OXFORD_CIRCUS_LON = -0.1419

PEAK_DATE = '20260325'
PEAK_TIME = '0830'
OFFPEAK_DATE = '20260325'
OFFPEAK_TIME = '1300'
OSRM_BASE_URL = 'https://router.project-osrm.org'


def load_stations(path: Path) -> list[dict[str, Any]]:
    return json.loads(path.read_text(encoding='utf-8'))


def parse_iso_time(raw_value: str | None) -> datetime | None:
    if not raw_value:
        return None
    try:
        return datetime.fromisoformat(raw_value)
    except ValueError:
        return None


def fetch_tfl_journeys(lat: float, lon: float, date: str, time: str) -> list[dict[str, Any]]:
    url = (
        'https://api.tfl.gov.uk/Journey/JourneyResults/'
        f'{lat:.6f},{lon:.6f}/to/{OXFORD_CIRCUS_LAT:.6f},{OXFORD_CIRCUS_LON:.6f}'
    )
    try:
        response = requests.get(
            url,
            params={
                'date': date,
                'time': time,
                'timeIs': 'Departing',
                'journeyPreference': 'leasttime',
            },
            timeout=12,
        )
    except requests.RequestException:
        return []

    if response.status_code != 200:
        return []
    payload = response.json()
    journeys = payload.get('journeys')
    return journeys if isinstance(journeys, list) else []


def fastest_duration_minutes(journeys: list[dict[str, Any]]) -> float | None:
    durations = [journey.get('duration') for journey in journeys if isinstance(journey.get('duration'), (int, float))]
    if not durations:
        return None
    return float(min(durations))


def best_interchange_count(journeys: list[dict[str, Any]]) -> int | None:
    best: tuple[float, int] | None = None
    for journey in journeys:
        duration = journey.get('duration')
        legs = journey.get('legs')
        if not isinstance(duration, (int, float)) or not isinstance(legs, list):
            continue

        transit_legs = 0
        for leg in legs:
            mode_name = str(((leg or {}).get('mode') or {}).get('name') or '').lower()
            if mode_name and mode_name != 'walking':
                transit_legs += 1
        interchanges = max(0, transit_legs - 1)
        candidate = (float(duration), interchanges)
        if best is None or candidate < best:
            best = candidate
    return None if best is None else int(best[1])


def estimate_peak_tph(journeys: list[dict[str, Any]]) -> float | None:
    starts: list[datetime] = []
    for journey in journeys:
        start = parse_iso_time(journey.get('startDateTime'))
        if start is not None:
            starts.append(start)

    if len(starts) < 2:
        return None

    starts.sort()
    headways: list[float] = []
    for idx in range(1, len(starts)):
        delta_min = (starts[idx] - starts[idx - 1]).total_seconds() / 60.0
        if delta_min > 0:
            headways.append(delta_min)

    if not headways:
        return None

    mean_headway = statistics.mean(headways)
    if mean_headway <= 0:
        return None
    tph = 60.0 / mean_headway
    return max(1.0, min(24.0, tph))


def osrm_probe_available(*, timeout_seconds: float = 5.0) -> bool:
    probe_url = (
        f'{OSRM_BASE_URL}/route/v1/driving/'
        f'{PINNER_LON:.6f},{PINNER_LAT:.6f};{PINNER_LON + 0.01:.6f},{PINNER_LAT + 0.01:.6f}'
    )
    try:
        response = requests.get(
            probe_url,
            params={'overview': 'false'},
            timeout=timeout_seconds,
        )
    except requests.RequestException:
        return False
    return response.status_code == 200


def fetch_osrm_drive_minutes(lat: float, lon: float, *, timeout_seconds: float = 6.0) -> float | None:
    url = (
        f'{OSRM_BASE_URL}/route/v1/driving/'
        f'{lon:.6f},{lat:.6f};{PINNER_LON:.6f},{PINNER_LAT:.6f}'
    )
    try:
        response = requests.get(url, params={'overview': 'false'}, timeout=timeout_seconds)
    except requests.RequestException:
        return None

    if response.status_code != 200:
        return None

    try:
        payload = response.json()
    except json.JSONDecodeError:
        return None

    routes = payload.get('routes')
    if not isinstance(routes, list) or not routes:
        return None

    duration_seconds = routes[0].get('duration')
    if not isinstance(duration_seconds, (int, float)):
        return None

    return float(duration_seconds) / 60.0


def build_transport_record(
    station: dict[str, Any],
    *,
    osrm_enabled: bool,
) -> tuple[str, dict[str, Any]]:
    station_code = str(station['station_code'])
    lat = float(station['lat'])
    lon = float(station['lon'])

    peak_journeys = fetch_tfl_journeys(lat, lon, PEAK_DATE, PEAK_TIME)
    offpeak_journeys = fetch_tfl_journeys(lat, lon, OFFPEAK_DATE, OFFPEAK_TIME)

    peak_commute = fastest_duration_minutes(peak_journeys)
    offpeak_commute = fastest_duration_minutes(offpeak_journeys)

    if peak_commute is not None and offpeak_commute is not None:
        typical_commute = (peak_commute + offpeak_commute) / 2.0
    elif peak_commute is not None:
        typical_commute = peak_commute * 0.94
    elif offpeak_commute is not None:
        typical_commute = offpeak_commute * 1.06
    else:
        typical_commute = None

    interchange_peak = best_interchange_count(peak_journeys)
    interchange_offpeak = best_interchange_count(offpeak_journeys)
    if interchange_peak is not None and interchange_offpeak is not None:
        interchange_count = int(round((interchange_peak + interchange_offpeak) / 2))
    elif interchange_peak is not None:
        interchange_count = interchange_peak
    elif interchange_offpeak is not None:
        interchange_count = interchange_offpeak
    else:
        interchange_count = None

    peak_tph = estimate_peak_tph(peak_journeys)
    drive_minutes = fetch_osrm_drive_minutes(lat, lon) if osrm_enabled else None

    fallback_typical = float(station.get('typical_commute_min', 60.0))
    fallback_peak = float(station.get('peak_commute_min', fallback_typical * 1.14 + 2))
    fallback_offpeak = float(station.get('offpeak_commute_min', fallback_typical * 0.9))
    fallback_tph = float(station.get('peak_tph', 6))
    fallback_interchange = int(station.get('interchange_count', 1))
    fallback_drive = float(station.get('drive_to_pinner_min', 35))

    used_tfl = typical_commute is not None
    used_osrm = drive_minutes is not None
    used_peak = peak_commute is not None
    used_offpeak = offpeak_commute is not None

    typical_value = float(typical_commute if typical_commute is not None else fallback_typical)
    peak_value = float(peak_commute if peak_commute is not None else fallback_peak)
    offpeak_value = float(offpeak_commute if offpeak_commute is not None else fallback_offpeak)
    tph_value = float(peak_tph if peak_tph is not None else fallback_tph)
    interchange_value = int(interchange_count if interchange_count is not None else fallback_interchange)
    drive_value = float(drive_minutes if drive_minutes is not None else fallback_drive)

    confidence = 0.45
    if used_peak and used_offpeak:
        confidence += 0.28
    elif used_tfl:
        confidence += 0.18
    if peak_tph is not None:
        confidence += 0.07
    if interchange_count is not None:
        confidence += 0.05
    if used_osrm:
        confidence += 0.15
    confidence = round(max(0.25, min(0.95, confidence)), 3)

    status = 'available' if used_peak and used_offpeak and used_osrm else 'estimated'
    methodology_parts = [
        'Commute from TfL Journey Planner (least-time route).'
        if used_tfl
        else 'Commute fallback from station profile heuristic.',
        'Drive-to-Pinner from OSRM route engine.'
        if used_osrm
        else 'Drive-to-Pinner fallback from station profile heuristic.',
        f'Peak query window: {PEAK_DATE} {PEAK_TIME}; off-peak query window: {OFFPEAK_DATE} {OFFPEAK_TIME}.',
    ]

    return (
        station_code,
        {
            'typical_commute_min': round(typical_value, 3),
            'peak_commute_min': round(peak_value, 3),
            'offpeak_commute_min': round(offpeak_value, 3),
            'peak_tph': round(tph_value, 3),
            'interchange_count': interchange_value,
            'drive_to_pinner_min': round(drive_value, 3),
            'status': status,
            'confidence': confidence,
            'methodology_note': ' '.join(methodology_parts),
            'reference_period': 'Snapshot queries to TfL Journey Planner and OSRM routing.',
            'source_release_date': datetime.now(ZoneInfo('Europe/London')).date().isoformat(),
        },
    )


def generate_transport_metrics(
    stations: list[dict[str, Any]],
    *,
    max_workers: int = 6,
    max_stations: int | None = None,
    osrm_enabled: bool = True,
) -> dict[str, dict[str, Any]]:
    selected = stations[:max_stations] if max_stations is not None else stations
    output: dict[str, dict[str, Any]] = {}

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = [
            executor.submit(
                build_transport_record,
                station,
                osrm_enabled=osrm_enabled,
            )
            for station in selected
        ]
        for idx, future in enumerate(as_completed(futures), start=1):
            station_code, record = future.result()
            output[station_code] = record
            if idx % 50 == 0:
                print(f'Processed {idx}/{len(selected)} stations...', flush=True)

    return output


def main() -> None:
    parser = argparse.ArgumentParser(
        description='Generate transport metrics using TfL Journey Planner + OSRM with heuristic fallback.',
    )
    parser.add_argument('--output', type=Path, default=OUTPUT_PATH)
    parser.add_argument('--max-workers', type=int, default=6)
    parser.add_argument('--max-stations', type=int, default=None)
    parser.add_argument('--disable-osrm', action='store_true')
    parser.add_argument('--osrm-probe-timeout', type=float, default=5.0)
    args = parser.parse_args()

    stations = load_stations(STATIONS_PATH)
    osrm_enabled = not args.disable_osrm and osrm_probe_available(timeout_seconds=max(1.0, args.osrm_probe_timeout))
    if not osrm_enabled:
        print('OSRM unavailable or disabled; drive-time values will use fallback station heuristics.', flush=True)
    metrics = generate_transport_metrics(
        stations,
        max_workers=max(1, args.max_workers),
        max_stations=args.max_stations,
        osrm_enabled=osrm_enabled,
    )
    args.output.write_text(json.dumps(metrics, indent=2, ensure_ascii=True), encoding='utf-8')
    print(f'Wrote {len(metrics)} transport metric records -> {args.output}')


if __name__ == '__main__':
    main()
