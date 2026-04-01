from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
from pathlib import Path

import requests


ROOT = Path(__file__).resolve().parents[2]
RAW_STATIONS_PATH = ROOT / 'data' / 'raw' / 'stations_transport.json'
PINNER = (51.5931, -0.3818)
OXFORD_CIRCUS = (51.5152, -0.1419)

ALLOWED_NETWORK_TERMS = (
    'National Rail',
    'London Underground',
    'London Overground',
    'Docklands Light Railway',
    'Elizabeth line',
)

EXCLUDED_NAME_PATTERNS = (
    re.compile(r'\bminiature\b', re.IGNORECASE),
    re.compile(r'\bheritage\b', re.IGNORECASE),
    re.compile(r'\btramway\b', re.IGNORECASE),
    re.compile(r'\bfunicular\b', re.IGNORECASE),
    re.compile(r'\bmodel railway\b', re.IGNORECASE),
    re.compile(r'\baquarium\b', re.IGNORECASE),
    re.compile(r'\btheme park\b', re.IGNORECASE),
)


def haversine_km(lat_1: float, lon_1: float, lat_2: float, lon_2: float) -> float:
    radius = 6371.0
    d_lat = math.radians(lat_2 - lat_1)
    d_lon = math.radians(lon_2 - lon_1)
    a = (
        math.sin(d_lat / 2) ** 2
        + math.cos(math.radians(lat_1))
        * math.cos(math.radians(lat_2))
        * math.sin(d_lon / 2) ** 2
    )
    return 2 * radius * math.asin(math.sqrt(a))


def fetch_station_candidates(radius_m: int) -> list[dict[str, object]]:
    query = f"""[out:json][timeout:180];
(
  node(around:{radius_m},{OXFORD_CIRCUS[0]},{OXFORD_CIRCUS[1]})["railway"="station"];
  way(around:{radius_m},{OXFORD_CIRCUS[0]},{OXFORD_CIRCUS[1]})["railway"="station"];
  relation(around:{radius_m},{OXFORD_CIRCUS[0]},{OXFORD_CIRCUS[1]})["railway"="station"];
);
out center tags;"""

    response = requests.post(
        'https://overpass-api.de/api/interpreter',
        data=query.encode('utf-8'),
        timeout=240,
    )
    response.raise_for_status()
    payload = response.json()

    candidates: list[dict[str, object]] = []

    for element in payload.get('elements', []):
        tags = element.get('tags', {})
        name = str(tags.get('name', '')).strip()

        if not name:
            continue
        if any(pattern.search(name) for pattern in EXCLUDED_NAME_PATTERNS):
            continue

        network = str(tags.get('network', '')).strip()
        if network and not any(term.lower() in network.lower() for term in ALLOWED_NETWORK_TERMS):
            continue
        if not network:
            network = 'National Rail'

        station_tag = str(tags.get('station', ''))
        if station_tag in {'disused', 'abandoned', 'construction', 'proposed', 'halt', 'miniature'}:
            continue
        usage = str(tags.get('usage', '')).strip().lower()
        if usage in {'tourism', 'industrial'}:
            continue
        service = str(tags.get('service', '')).strip().lower()
        if service in {'siding', 'yard'}:
            continue

        lat = element.get('lat') or (element.get('center') or {}).get('lat')
        lon = element.get('lon') or (element.get('center') or {}).get('lon')

        if lat is None or lon is None:
            continue

        lat_value = float(lat)
        lon_value = float(lon)

        candidates.append(
            {
                'name': name,
                'network': network,
                'tags': tags,
                'lat': lat_value,
                'lon': lon_value,
            },
        )

    return candidates


def dedupe_candidates(candidates: list[dict[str, object]]) -> list[dict[str, object]]:
    deduped: list[dict[str, object]] = []

    for candidate in sorted(candidates, key=lambda item: str(item['name']).lower()):
        name = str(candidate['name'])
        normalized = re.sub(r'\s+', ' ', name.lower()).strip()
        lat = float(candidate['lat'])
        lon = float(candidate['lon'])
        tags = candidate['tags']

        merged = False
        for existing in deduped:
            if existing['normalized'] != normalized:
                continue

            distance_m = haversine_km(
                lat,
                lon,
                float(existing['lat']),
                float(existing['lon']),
            ) * 1000
            if distance_m < 350:
                if len(tags) > len(existing['tags']):  # keep richer metadata
                    existing.update(
                        {
                            'lat': lat,
                            'lon': lon,
                            'network': candidate['network'],
                            'tags': tags,
                        },
                    )
                merged = True
                break

        if not merged:
            deduped.append(
                {
                    'name': name,
                    'normalized': normalized,
                    'network': candidate['network'],
                    'tags': tags,
                    'lat': lat,
                    'lon': lon,
                },
            )

    return deduped


def build_postcode_lookup():
    session = requests.Session()
    cache: dict[tuple[float, float], dict[str, str]] = {}

    def lookup(lat: float, lon: float) -> dict[str, str]:
        key = (round(lat, 4), round(lon, 4))
        if key in cache:
            return cache[key]

        try:
            response = session.get(
                'https://api.postcodes.io/postcodes',
                params={'lon': lon, 'lat': lat},
                timeout=12,
            )
            if response.status_code == 200:
                result = response.json().get('result') or []
                if result:
                    best = result[0]
                    payload = {
                        'admin_district': str(best.get('admin_district') or 'Unknown'),
                        'admin_county': str(best.get('admin_county') or ''),
                        'region': str(best.get('region') or ''),
                    }
                    cache[key] = payload
                    return payload
        except requests.RequestException:
            pass

        fallback = {'admin_district': 'Unknown', 'admin_county': '', 'region': ''}
        cache[key] = fallback
        return fallback

    return lookup


def transport_profile(network: str) -> tuple[str, float, int]:
    lowered = network.lower()
    if 'docklands light railway' in lowered:
        return ('dlr', 28.0, 10)
    if 'elizabeth line' in lowered:
        return ('elizabeth', 42.0, 12)
    if 'london underground' in lowered:
        return ('tube', 31.0, 11)
    if 'london overground' in lowered:
        return ('overground', 34.0, 8)
    return ('national_rail', 47.0, 6)


def infer_transport_metrics(lat: float, lon: float, network: str) -> dict[str, float | int]:
    mode, speed_kmh, tph_base = transport_profile(network)

    distance_to_oxford = haversine_km(lat, lon, OXFORD_CIRCUS[0], OXFORD_CIRCUS[1])
    distance_to_pinner = haversine_km(lat, lon, PINNER[0], PINNER[1])

    if mode in {'tube', 'dlr'} and distance_to_oxford < 10:
        interchange_count = 0
    elif distance_to_oxford < 24:
        interchange_count = 1
    else:
        interchange_count = 2

    typical_commute = 8 + (distance_to_oxford / speed_kmh) * 60 + interchange_count * 5 + 2
    typical_commute = max(10, min(88, typical_commute))
    peak_commute = min(100, typical_commute * 1.14 + 2)
    offpeak_commute = max(8, typical_commute * 0.9)

    road_distance_km = distance_to_pinner * 1.35
    drive_to_pinner = 4 + (road_distance_km / 28) * 60
    drive_to_pinner = min(150, max(3, drive_to_pinner))

    peak_tph = tph_base + (2 if distance_to_oxford < 10 else 0)

    return {
        'typical_commute_min': round(typical_commute, 1),
        'peak_commute_min': round(peak_commute, 1),
        'offpeak_commute_min': round(offpeak_commute, 1),
        'peak_tph': int(round(peak_tph)),
        'interchange_count': int(interchange_count),
        'drive_to_pinner_min': round(drive_to_pinner, 1),
    }


def stable_station_code(
    station_name: str,
    lat: float,
    lon: float,
    existing_code_by_name: dict[str, str],
    used_codes: set[str],
) -> str:
    existing = existing_code_by_name.get(station_name.strip().lower())
    if existing:
        used_codes.add(existing)
        return existing

    alnum = re.sub(r'[^A-Za-z0-9]+', '', station_name.upper())
    base = alnum[:5] if alnum else 'STAT'
    suffix = hashlib.sha1(f"{station_name}|{lat:.5f}|{lon:.5f}".encode('utf-8')).hexdigest()[:3].upper()
    code = (base + suffix)[:8]

    counter = 0
    while code in used_codes:
        counter += 1
        suffix = hashlib.sha1(f"{station_name}|{lat:.5f}|{lon:.5f}|{counter}".encode('utf-8')).hexdigest()[
            :4
        ].upper()
        code = (base[:4] + suffix)[:8]

    used_codes.add(code)
    return code


def build_station_records(radius_m: int) -> list[dict[str, object]]:
    seed_records = json.loads(RAW_STATIONS_PATH.read_text(encoding='utf-8'))
    code_by_name = {str(item['station_name']).strip().lower(): str(item['station_code']) for item in seed_records}
    used_codes: set[str] = set()

    candidates = fetch_station_candidates(radius_m)
    deduped = dedupe_candidates(candidates)
    postcode_lookup = build_postcode_lookup()

    records: list[dict[str, object]] = []

    for station in deduped:
        lat = float(station['lat'])
        lon = float(station['lon'])
        geo = postcode_lookup(lat, lon)
        if geo['admin_district'] == 'Unknown' and not geo['region']:
            continue

        station_name = str(station['name'])
        tags = station['tags']
        network = str(station['network'])
        line_tag = str(tags.get('line', ''))
        lines = [part.strip() for part in line_tag.split(';') if part.strip()]
        if not lines:
            lines = [part.strip() for part in network.split(';') if part.strip()] or ['National Rail']

        station_code = stable_station_code(station_name, lat, lon, code_by_name, used_codes)
        operator = str(tags.get('operator') or network or 'Unknown operator')
        transport = infer_transport_metrics(lat, lon, network)

        records.append(
            {
                'station_code': station_code,
                'station_name': station_name,
                'operator': operator,
                'lines': lines,
                'local_authority': geo['admin_district'] or 'Unknown',
                'county_or_borough': (
                    'Greater London'
                    if geo['region'] == 'London'
                    else geo['admin_county'] or geo['region'] or 'Unknown'
                ),
                'lat': round(lat, 6),
                'lon': round(lon, 6),
                **transport,
            },
        )

    by_code = {str(record['station_code']): record for record in records}

    # Preserve original seed records (for nearby non-London stations and known anchors).
    for seed in seed_records:
        station_code = str(seed['station_code'])
        if station_code not in by_code:
            by_code[station_code] = seed

    merged = sorted(by_code.values(), key=lambda item: str(item['station_name']).lower())
    return merged


def main() -> None:
    parser = argparse.ArgumentParser(
        description='Regenerate expanded station fixture around central London with Greater London coverage.',
    )
    parser.add_argument(
        '--radius-m',
        type=int,
        default=120_000,
        help='Overpass radius around Central London in meters.',
    )
    args = parser.parse_args()

    records = build_station_records(args.radius_m)
    RAW_STATIONS_PATH.write_text(json.dumps(records, indent=2, ensure_ascii=True), encoding='utf-8')
    print(f'Wrote {len(records)} stations to {RAW_STATIONS_PATH}')


if __name__ == '__main__':
    main()
