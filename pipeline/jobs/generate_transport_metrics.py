from __future__ import annotations

import argparse
import json
import re
import statistics
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from pipeline.jobs.osrm_utils import fetch_json_with_curl_fallback
from pipeline.jobs.station_scope import candidate_scope_station_codes


ROOT = Path(__file__).resolve().parents[2]
STATIONS_PATH = ROOT / 'data' / 'raw' / 'stations_transport.json'
OUTPUT_PATH = ROOT / 'data' / 'raw' / 'transport_metrics.json'
SOURCE_METADATA_PATH = ROOT / 'data' / 'raw' / 'source_metadata.json'

PINNER_LAT = 51.5931
PINNER_LON = -0.3818
CENTRAL_LONDON_DESTINATIONS: tuple[tuple[str, float, float], ...] = (
    ('Oxford Circus', 51.5152, -0.1419),
    ('Bank', 51.5133, -0.0890),
    ('Victoria', 51.4965, -0.1447),
    ('Waterloo', 51.5033, -0.1147),
)

PEAK_QUERY_WINDOWS: tuple[tuple[str, str], ...] = (
    ('20260325', '0815'),
    ('20260325', '0830'),
    ('20260325', '0845'),
    ('20260326', '0830'),
)
OFFPEAK_QUERY_WINDOWS: tuple[tuple[str, str], ...] = (
    ('20260325', '1230'),
    ('20260325', '1300'),
    ('20260325', '1330'),
    ('20260326', '1300'),
)
OSRM_BASE_URL = 'https://router.project-osrm.org'
STOPPOINT_SEARCH_TYPES = 'NaptanMetroStation,NaptanRailStation'


def load_stations(path: Path) -> list[dict[str, Any]]:
    return json.loads(path.read_text(encoding='utf-8'))


def update_source_metadata(reference_period: str, release_date: str) -> None:
    payload: dict[str, Any] = {}
    if SOURCE_METADATA_PATH.exists():
        existing = json.loads(SOURCE_METADATA_PATH.read_text(encoding='utf-8'))
        if isinstance(existing, dict):
            payload = existing

    payload['transport'] = {
        'source': 'TfL Journey Planner + TfL StopPoint arrivals + OSRM (with station-profile fallback)',
        'referencePeriod': reference_period,
        'releaseDate': release_date,
    }
    SOURCE_METADATA_PATH.write_text(json.dumps(payload, indent=2, ensure_ascii=True), encoding='utf-8')


def parse_iso_time(raw_value: str | None) -> datetime | None:
    if not raw_value:
        return None
    try:
        return datetime.fromisoformat(raw_value)
    except ValueError:
        return None


def normalize_station_name(raw_value: str) -> str:
    normalized = re.sub(r'[^a-z0-9]+', ' ', raw_value.lower()).strip()
    for token in (' underground station', ' rail station', ' dlr station', ' station'):
        if normalized.endswith(token):
            normalized = normalized[: -len(token)].strip()
    return normalized


def fetch_tfl_journeys(
    lat: float,
    lon: float,
    date: str,
    time: str,
    *,
    destination: tuple[str, float, float],
) -> list[dict[str, Any]]:
    _label, destination_lat, destination_lon = destination
    url = (
        'https://api.tfl.gov.uk/Journey/JourneyResults/'
        f'{lat:.6f},{lon:.6f}/to/{destination_lat:.6f},{destination_lon:.6f}'
    )
    payload = fetch_json_with_curl_fallback(
        url,
        params={
            'date': date,
            'time': time,
            'timeIs': 'Departing',
            'journeyPreference': 'leasttime',
        },
        timeout_seconds=12,
        cache_namespace='tfl-journeys',
        cache_ttl_hours=72,
    )
    if not isinstance(payload, dict):
        return []
    journeys = payload.get('journeys')
    return journeys if isinstance(journeys, list) else []


def fetch_best_tfl_window(
    lat: float,
    lon: float,
    *,
    query_windows: tuple[tuple[str, str], ...],
) -> tuple[list[dict[str, Any]], str | None, str | None, str | None]:
    best_journeys: list[dict[str, Any]] = []
    best_duration: float | None = None
    selected_label: str | None = None
    selected_date: str | None = None
    selected_time: str | None = None

    for date, time in query_windows:
        for idx, destination in enumerate(CENTRAL_LONDON_DESTINATIONS):
            journeys = fetch_tfl_journeys(lat, lon, date, time, destination=destination)
            duration = fastest_duration_minutes(journeys)
            if duration is not None and (best_duration is None or duration < best_duration):
                best_duration = duration
                best_journeys = journeys
                selected_label = destination[0]
                selected_date = date
                selected_time = time

            # Keep the first successful Oxford Circus result within the current window to limit extra requests.
            if idx == 0 and duration is not None:
                break
            if best_duration is not None:
                break
        if best_duration is not None:
            break

    return best_journeys, selected_label, selected_date, selected_time


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


def fetch_nearby_station_stoppoints(lat: float, lon: float) -> list[dict[str, Any]]:
    payload = fetch_json_with_curl_fallback(
        'https://api.tfl.gov.uk/Stoppoint',
        params={
            'lat': f'{lat:.6f}',
            'lon': f'{lon:.6f}',
            'stoptypes': STOPPOINT_SEARCH_TYPES,
        },
        timeout_seconds=12,
        cache_namespace='tfl-stoppoints',
        cache_ttl_hours=24 * 7,
    )
    if not isinstance(payload, dict):
        return []
    stop_points = payload.get('stopPoints')
    return stop_points if isinstance(stop_points, list) else []


def stoppoint_match_key(station_name: str, stop_point: dict[str, Any]) -> tuple[int, float]:
    station_normalized = normalize_station_name(station_name)
    stop_name = normalize_station_name(str(stop_point.get('commonName') or ''))
    score = 0
    if stop_name == station_normalized:
        score += 5
    elif station_normalized and (station_normalized in stop_name or stop_name in station_normalized):
        score += 3

    modes = stop_point.get('modes')
    if isinstance(modes, list):
        if any(mode in {'tube', 'dlr', 'overground', 'elizabeth-line', 'tram'} for mode in modes):
            score += 2
        elif any(mode in {'national-rail'} for mode in modes):
            score += 1

    distance = stop_point.get('distance')
    numeric_distance = float(distance) if isinstance(distance, (int, float)) else 999999.0
    return (-score, numeric_distance)


def fetch_station_arrivals(station: dict[str, Any]) -> tuple[list[dict[str, Any]], str | None]:
    station_name = str(station['station_name'])
    stop_points = fetch_nearby_station_stoppoints(float(station['lat']), float(station['lon']))
    candidates = sorted(
        (stop_point for stop_point in stop_points if isinstance(stop_point, dict)),
        key=lambda stop_point: stoppoint_match_key(station_name, stop_point),
    )

    for stop_point in candidates[:4]:
        stop_id = stop_point.get('id')
        if not isinstance(stop_id, str):
            continue
        payload = fetch_json_with_curl_fallback(
            f'https://api.tfl.gov.uk/StopPoint/{stop_id}/Arrivals',
            timeout_seconds=12,
            cache_namespace='tfl-arrivals',
            cache_ttl_hours=2,
        )
        if isinstance(payload, list) and payload:
            return payload, str(stop_point.get('commonName') or stop_id)

    return [], None


def estimate_tph_from_arrivals(arrivals: list[dict[str, Any]]) -> float | None:
    by_platform: dict[str, list[float]] = {}
    for row in arrivals:
        if not isinstance(row, dict):
            continue
        time_to_station = row.get('timeToStation')
        if not isinstance(time_to_station, (int, float)):
            continue
        if time_to_station < 0 or time_to_station > 3600:
            continue
        platform = str(row.get('platformName') or row.get('towards') or 'default')
        by_platform.setdefault(platform, []).append(float(time_to_station) / 60.0)

    if not by_platform:
        return None

    tph_total = 0.0
    for arrivals_min in by_platform.values():
        arrivals_min.sort()
        if len(arrivals_min) >= 2:
            headways = [
                arrivals_min[idx] - arrivals_min[idx - 1]
                for idx in range(1, len(arrivals_min))
                if arrivals_min[idx] - arrivals_min[idx - 1] > 0
            ]
            if headways:
                tph_total += 60.0 / statistics.mean(headways)
                continue

        arrivals_in_30 = sum(1 for minute in arrivals_min if minute <= 30.0)
        if arrivals_in_30 > 0:
            tph_total += arrivals_in_30 * 2.0

    if tph_total <= 0:
        return None
    return max(1.0, min(24.0, tph_total))


def osrm_probe_available(*, timeout_seconds: float = 5.0) -> bool:
    probe_url = (
        f'{OSRM_BASE_URL}/route/v1/driving/'
        f'{PINNER_LON:.6f},{PINNER_LAT:.6f};{PINNER_LON + 0.01:.6f},{PINNER_LAT + 0.01:.6f}'
    )
    payload = fetch_json_with_curl_fallback(
        probe_url,
        params={'overview': 'false'},
        timeout_seconds=timeout_seconds,
        cache_namespace='osrm-probe',
        cache_ttl_hours=168,
    )
    return isinstance(payload, dict) and payload.get('code') == 'Ok'


def fetch_osrm_drive_minutes(lat: float, lon: float, *, timeout_seconds: float = 6.0) -> float | None:
    url = (
        f'{OSRM_BASE_URL}/route/v1/driving/'
        f'{lon:.6f},{lat:.6f};{PINNER_LON:.6f},{PINNER_LAT:.6f}'
    )
    payload = fetch_json_with_curl_fallback(
        url,
        params={'overview': 'false'},
        timeout_seconds=timeout_seconds,
        cache_namespace='osrm-route',
        cache_ttl_hours=168,
    )
    if not isinstance(payload, dict):
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

    peak_journeys, peak_destination, peak_date_used, peak_time_used = fetch_best_tfl_window(
        lat,
        lon,
        query_windows=PEAK_QUERY_WINDOWS,
    )
    offpeak_journeys, offpeak_destination, offpeak_date_used, offpeak_time_used = fetch_best_tfl_window(
        lat,
        lon,
        query_windows=OFFPEAK_QUERY_WINDOWS,
    )

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

    arrivals, arrival_station_name = fetch_station_arrivals(station)
    peak_tph = estimate_peak_tph(peak_journeys)
    peak_tph_source = 'journeys' if peak_tph is not None else None
    if peak_tph is None:
        peak_tph = estimate_tph_from_arrivals(arrivals)
        if peak_tph is not None:
            peak_tph_source = 'live_arrivals'
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
    used_arrivals = peak_tph_source == 'live_arrivals'

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
        confidence += 0.04 if used_arrivals else 0.07
    if interchange_count is not None:
        confidence += 0.05
    if used_osrm:
        confidence += 0.15
    confidence = round(max(0.25, min(0.95, confidence)), 3)

    field_statuses = {
        'typical_commute_min': 'available' if used_tfl else 'estimated',
        'peak_commute_min': 'available' if used_peak else 'estimated',
        'offpeak_commute_min': 'available' if used_offpeak else 'estimated',
        'peak_tph': 'available' if peak_tph is not None else 'estimated',
        'interchange_count': 'available' if interchange_count is not None else 'estimated',
        'drive_to_pinner_min': 'available' if used_osrm else 'estimated',
    }
    field_confidences = {
        'typical_commute_min': round(0.88 if used_peak and used_offpeak else 0.72 if used_tfl else 0.48, 3),
        'peak_commute_min': round(0.84 if used_peak else 0.48, 3),
        'offpeak_commute_min': round(0.84 if used_offpeak else 0.48, 3),
        'peak_tph': round(0.68 if used_arrivals else 0.78 if peak_tph is not None else 0.45, 3),
        'interchange_count': round(0.78 if interchange_count is not None else 0.45, 3),
        'drive_to_pinner_min': round(0.88 if used_osrm else 0.5, 3),
    }
    field_provenance = {key: ('direct' if status_value == 'available' else 'heuristic') for key, status_value in field_statuses.items()}
    if used_arrivals:
        field_provenance['peak_tph'] = 'direct_live_arrivals'

    status = 'available' if used_tfl or used_osrm or used_arrivals else 'estimated'
    methodology_parts = [
        (
            f'Commute from TfL Journey Planner (least-time route) to {peak_destination or offpeak_destination or "the central London core"}.'
        )
        if used_tfl
        else 'Commute fallback from station profile heuristic.',
        (
            f'Service frequency derived from live TfL StopPoint arrivals at {arrival_station_name}.'
        )
        if used_arrivals
        else 'Service frequency estimated from the returned peak journey headways.'
        if peak_tph_source == 'journeys'
        else 'Service frequency fallback from station profile heuristic.',
        'Drive-to-Pinner from OSRM route engine.'
        if used_osrm
        else 'Drive-to-Pinner fallback from station profile heuristic.',
        (
            f'Peak query window: {(peak_date_used or PEAK_QUERY_WINDOWS[0][0])} {(peak_time_used or PEAK_QUERY_WINDOWS[0][1])} '
            f'(destination {peak_destination or "fallback"}); '
            f'off-peak query window: {(offpeak_date_used or OFFPEAK_QUERY_WINDOWS[0][0])} {(offpeak_time_used or OFFPEAK_QUERY_WINDOWS[0][1])} '
            f'(destination {offpeak_destination or "fallback"}).'
        ),
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
            'provenance': 'direct' if used_tfl or used_osrm else 'heuristic',
            'field_statuses': field_statuses,
            'field_confidences': field_confidences,
            'field_provenance': field_provenance,
            'methodology_note': ' '.join(methodology_parts),
            'reference_period': 'Snapshot queries to the TfL Journey Planner central-London core, TfL StopPoint arrivals, and OSRM routing.',
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

    scope_station_codes = candidate_scope_station_codes()
    stations = [
        station
        for station in load_stations(STATIONS_PATH)
        if str(station.get('station_code')) in scope_station_codes
    ]
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
    release_date = datetime.now(ZoneInfo('Europe/London')).date().isoformat()
    update_source_metadata(
        reference_period=(
            'Snapshot queries to the TfL Journey Planner central-London core, '
            'TfL StopPoint arrivals, and OSRM routing using query windows on '
            '2026-03-25 and 2026-03-26.'
        ),
        release_date=release_date,
    )
    print(f'Wrote {len(metrics)} transport metric records -> {args.output}')


if __name__ == '__main__':
    main()
