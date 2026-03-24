from __future__ import annotations

import argparse
import csv
import io
import json
import math
import statistics
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, timedelta
from pathlib import Path
from typing import Any

import requests


ROOT = Path(__file__).resolve().parents[2]
RAW_DIR = ROOT / 'data' / 'raw'
STATIONS_PATH = RAW_DIR / 'stations_transport.json'
OUTPUT_PATH = RAW_DIR / 'property_metrics.json'
SOURCE_METADATA_PATH = RAW_DIR / 'source_metadata.json'

POSTCODES_API_URL = 'https://api.postcodes.io/postcodes'
PPD_CSV_URL = 'https://landregistry.data.gov.uk/app/ppd/ppd_data.csv'

CATCHMENT_RADIUS_M = 800
POSTCODE_LIMIT_PER_STATION = 100
MAX_POSTCODES_PER_BAND = 30
MAX_TRANSACTIONS_PER_BAND = 40

BANDS: list[tuple[str, float, float]] = [
    ('inner', 0.0, 300.0),
    ('middle', 300.0, 550.0),
    ('outer', 550.0, 800.0),
]

BAND_PRICE_WEIGHTS: dict[str, float] = {
    'inner': 1.35,
    'middle': 1.0,
    'outer': 0.75,
}


def clamp(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(maximum, value))


def haversine_distance_m(lat_1: float, lon_1: float, lat_2: float, lon_2: float) -> float:
    radius_m = 6_371_000
    p_lat_1 = math.radians(lat_1)
    p_lon_1 = math.radians(lon_1)
    p_lat_2 = math.radians(lat_2)
    p_lon_2 = math.radians(lon_2)

    d_lat = p_lat_2 - p_lat_1
    d_lon = p_lon_2 - p_lon_1

    h = math.sin(d_lat / 2) ** 2 + math.cos(p_lat_1) * math.cos(p_lat_2) * math.sin(d_lon / 2) ** 2
    return radius_m * 2 * math.asin(math.sqrt(h))


def normalize_postcode(raw_postcode: str) -> str:
    stripped = ''.join(raw_postcode.upper().split())
    if len(stripped) <= 3:
        return stripped
    return f'{stripped[:-3]} {stripped[-3:]}'


def postcode_band(distance_m: float) -> str | None:
    for band_name, low, high in BANDS:
        if low <= distance_m <= high:
            return band_name
    return None


def window_dates(reference_day: date) -> tuple[date, date, date, date]:
    current_end = reference_day
    current_start = current_end - timedelta(days=365)
    prior_end = current_start - timedelta(days=1)
    prior_start = prior_end - timedelta(days=365)
    return current_start, current_end, prior_start, prior_end


def load_stations(path: Path) -> list[dict[str, Any]]:
    payload = json.loads(path.read_text(encoding='utf-8'))
    return payload if isinstance(payload, list) else []


def fetch_nearby_postcodes(lat: float, lon: float) -> list[dict[str, Any]]:
    try:
        response = requests.get(
            POSTCODES_API_URL,
            params={
                'lat': f'{lat:.6f}',
                'lon': f'{lon:.6f}',
                'radius': CATCHMENT_RADIUS_M,
                'limit': POSTCODE_LIMIT_PER_STATION,
            },
            timeout=25,
        )
    except requests.RequestException:
        return []

    if response.status_code != 200:
        return []

    result = response.json().get('result')
    if not isinstance(result, list):
        return []

    samples: list[dict[str, Any]] = []
    seen: set[str] = set()
    for row in result:
        if not isinstance(row, dict):
            continue
        postcode_raw = row.get('postcode')
        row_lat = row.get('latitude')
        row_lon = row.get('longitude')
        outcode = row.get('outcode')
        if not isinstance(postcode_raw, str) or not isinstance(outcode, str):
            continue
        if not isinstance(row_lat, (int, float)) or not isinstance(row_lon, (int, float)):
            continue

        normalized = normalize_postcode(postcode_raw)
        if normalized in seen:
            continue
        seen.add(normalized)

        distance_m = haversine_distance_m(lat, lon, float(row_lat), float(row_lon))
        band = postcode_band(distance_m)
        if band is None:
            continue

        samples.append(
            {
                'postcode': normalized,
                'outcode': str(outcode).upper(),
                'lat': float(row_lat),
                'lon': float(row_lon),
                'distance_m': float(distance_m),
                'band': band,
            },
        )

    return samples


def stratified_postcode_sample(postcodes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in postcodes:
        grouped[str(row['band'])].append(row)

    for rows in grouped.values():
        rows.sort(key=lambda item: (float(item['distance_m']), str(item['postcode'])))

    selected: list[dict[str, Any]] = []
    selected_postcodes: set[str] = set()
    for band_name, _low, _high in BANDS:
        band_rows = grouped.get(band_name, [])
        for row in band_rows[:MAX_POSTCODES_PER_BAND]:
            postcode = str(row['postcode'])
            if postcode in selected_postcodes:
                continue
            selected_postcodes.add(postcode)
            selected.append(row)

    selected.sort(key=lambda item: (float(item['distance_m']), str(item['postcode'])))
    return selected


def fetch_outcode_transactions(
    outcode: str,
    *,
    min_date: date,
    max_date: date,
    retries: int = 3,
) -> list[dict[str, Any]]:
    params = {
        'header': 'true',
        'limit': 'all',
        'postcode': outcode,
        'ptype[]': 'lrcommon:semi-detached',
        'tc[]': 'ppd:standardPricePaidTransaction',
        'min_date': min_date.isoformat(),
        'max_date': max_date.isoformat(),
    }

    backoff = 1.0
    for attempt in range(retries):
        try:
            response = requests.get(PPD_CSV_URL, params=params, timeout=45)
            if response.status_code != 200:
                raise RuntimeError(f'HTTP {response.status_code}')
            text = response.text
            reader = csv.DictReader(io.StringIO(text))
            rows: list[dict[str, Any]] = []
            for row in reader:
                postcode_raw = row.get('postcode')
                price_raw = row.get('price_paid')
                deed_date = row.get('deed_date')
                unique_id = row.get('unique_id')
                if not postcode_raw or not price_raw or not deed_date or not unique_id:
                    continue
                try:
                    price = float(price_raw)
                except ValueError:
                    continue

                rows.append(
                    {
                        'unique_id': str(unique_id),
                        'postcode': normalize_postcode(str(postcode_raw)),
                        'price': price,
                        'deed_date': str(deed_date),
                    },
                )
            return rows
        except Exception:  # noqa: BLE001
            if attempt >= retries - 1:
                return []
            time.sleep(backoff)
            backoff *= 2

    return []


def bucket_transactions_by_postcode(rows: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        grouped[str(row['postcode'])].append(row)
    for postcode_rows in grouped.values():
        postcode_rows.sort(key=lambda item: str(item['deed_date']), reverse=True)
    return grouped


def parse_deed_date(value: str) -> date | None:
    try:
        return date.fromisoformat(value[:10])
    except ValueError:
        return None


def distance_weight(distance_m: float) -> float:
    normalized = clamp(distance_m / CATCHMENT_RADIUS_M, 0.0, 1.0)
    return 0.75 + (1.0 - normalized) * 0.5


def recency_weight(*, deed_date: date | None, window_end: date) -> float:
    if deed_date is None:
        return 1.0

    age_days = clamp(float((window_end - deed_date).days), 0.0, 365.0)
    freshness = 1.0 - age_days / 365.0
    return 0.7 + freshness * 0.6


def weighted_mean(values: list[float], weights: list[float]) -> float:
    if not values or not weights or len(values) != len(weights):
        raise ValueError('values and weights must be same length and non-empty')

    total_weight = sum(max(0.0, weight) for weight in weights)
    if total_weight <= 0:
        return float(statistics.mean(values))

    weighted_sum = sum(value * max(0.0, weight) for value, weight in zip(values, weights))
    return float(weighted_sum / total_weight)


def weighted_median(values: list[float], weights: list[float]) -> float:
    if not values or not weights or len(values) != len(weights):
        raise ValueError('values and weights must be same length and non-empty')

    pairs = sorted(zip(values, weights), key=lambda item: item[0])
    total_weight = sum(max(0.0, weight) for _, weight in pairs)
    if total_weight <= 0:
        return float(statistics.median(values))

    threshold = total_weight / 2
    cumulative = 0.0
    for value, weight in pairs:
        cumulative += max(0.0, weight)
        if cumulative >= threshold:
            return float(value)

    return float(pairs[-1][0])


def sample_station_transactions(
    selected_postcodes: list[dict[str, Any]],
    transactions_by_outcode: dict[str, dict[str, list[dict[str, Any]]]],
) -> tuple[list[dict[str, Any]], dict[str, int], int]:
    by_band: dict[str, list[dict[str, Any]]] = defaultdict(list)
    postcodes_with_transactions: set[str] = set()

    for postcode_row in selected_postcodes:
        postcode = str(postcode_row['postcode'])
        outcode = str(postcode_row['outcode'])
        band = str(postcode_row['band'])
        postcode_transactions = (transactions_by_outcode.get(outcode, {}) or {}).get(postcode, [])
        if postcode_transactions:
            postcodes_with_transactions.add(postcode)
        by_band[band].extend(postcode_transactions)

    for rows in by_band.values():
        rows.sort(key=lambda item: str(item['deed_date']), reverse=True)

    sampled: list[dict[str, Any]] = []
    strata_counts: dict[str, int] = {}
    for band_name, _low, _high in BANDS:
        band_rows = by_band.get(band_name, [])
        selected_rows = band_rows[:MAX_TRANSACTIONS_PER_BAND]
        sampled.extend(selected_rows)
        strata_counts[band_name] = len(selected_rows)

    return sampled, strata_counts, len(postcodes_with_transactions)


def affordability_score(median_price: float) -> float:
    # Lower prices score higher; range tuned to semi-detached market in target region.
    return round(clamp(100 * (1 - (median_price - 250_000) / (1_300_000 - 250_000)), 0, 100), 2)


def commute_value_score(typical_commute_min: float) -> float:
    return round(clamp(100 * (1 - (typical_commute_min - 20) / (75 - 20)), 0, 100), 2)


def build_property_record(
    station: dict[str, Any],
    current_by_outcode: dict[str, dict[str, list[dict[str, Any]]]],
    prior_by_outcode: dict[str, dict[str, list[dict[str, Any]]]],
    selected_postcodes: list[dict[str, Any]],
    *,
    current_window: tuple[date, date],
    prior_window: tuple[date, date],
) -> dict[str, Any] | None:
    if not selected_postcodes:
        return None

    current_rows, current_strata, postcode_hits = sample_station_transactions(
        selected_postcodes,
        current_by_outcode,
    )
    if not current_rows:
        return None

    postcode_lookup = {str(item['postcode']): item for item in selected_postcodes}

    def build_weights(rows: list[dict[str, Any]], *, window_end: date) -> list[float]:
        computed: list[float] = []
        for row in rows:
            postcode = str(row.get('postcode', ''))
            postcode_meta = postcode_lookup.get(postcode, {})
            band = str(postcode_meta.get('band', 'middle'))
            distance_m = float(postcode_meta.get('distance_m', CATCHMENT_RADIUS_M * 0.7))
            band_weight = BAND_PRICE_WEIGHTS.get(band, 1.0)
            deed = parse_deed_date(str(row.get('deed_date', '')))
            weight = band_weight * distance_weight(distance_m) * recency_weight(
                deed_date=deed,
                window_end=window_end,
            )
            computed.append(max(0.1, float(weight)))
        return computed

    prices = [float(row['price']) for row in current_rows]
    current_weights = build_weights(current_rows, window_end=current_window[1])
    median_price = weighted_median(prices, current_weights)
    average_price = weighted_mean(prices, current_weights)

    prior_rows, _prior_strata, _prior_postcodes = sample_station_transactions(
        selected_postcodes,
        prior_by_outcode,
    )
    prior_prices = [float(row['price']) for row in prior_rows]
    prior_weights = build_weights(prior_rows, window_end=prior_window[1]) if prior_rows else []
    prior_median = weighted_median(prior_prices, prior_weights) if prior_prices else None
    trend_proxy = (
        ((median_price - prior_median) / prior_median) * 100.0
        if prior_median and prior_median > 0
        else None
    )

    band_coverage = sum(1 for value in current_strata.values() if value > 0)
    sample_size = len(prices)
    status = 'available' if sample_size >= 15 and band_coverage >= 2 else 'estimated'

    confidence = 0.32
    confidence += min(0.38, sample_size / 80 * 0.38)
    confidence += (band_coverage / 3) * 0.16
    confidence += 0.08 if trend_proxy is not None else 0.0
    confidence = round(clamp(confidence, 0.25, 0.92), 3)

    commute_score = commute_value_score(float(station.get('typical_commute_min', 55)))
    afford_score = affordability_score(median_price)
    value_for_money = round(afford_score * 0.68 + commute_score * 0.32, 2)

    current_start, current_end = current_window
    prior_start, prior_end = prior_window
    methodology_note = (
        'HM Land Registry PPD semi-detached standard transactions. '
        f'Catchment postcode sample from postcodes.io within {CATCHMENT_RADIUS_M}m '
        'using distance strata (0-300m, 300-550m, 550-800m) and capped per-stratum sampling. '
        'Median/average are distance-and-recency weighted so nearer catchment transactions and '
        'newer sales have higher influence (band weights inner=1.35, middle=1.0, outer=0.75). '
        f'Current window {current_start.isoformat()} to {current_end.isoformat()}; '
        f'prior window {prior_start.isoformat()} to {prior_end.isoformat()} for trend proxy. '
        f'Sample transactions={sample_size}, postcodes with transactions={postcode_hits}, '
        f'strata={current_strata}.'
    )

    return {
        'average_semi_price': round(average_price, 2),
        'median_semi_price': round(median_price, 2),
        'price_trend_pct_5y': None if trend_proxy is None else round(float(trend_proxy), 3),
        'affordability_score': afford_score,
        'value_for_money_score': value_for_money,
        'status': status,
        'confidence': confidence,
        'methodology_note': methodology_note,
    }


def update_source_metadata(reference_period: str, release_date: str) -> None:
    payload: dict[str, Any] = {}
    if SOURCE_METADATA_PATH.exists():
        existing = json.loads(SOURCE_METADATA_PATH.read_text(encoding='utf-8'))
        if isinstance(existing, dict):
            payload = existing

    payload['property'] = {
        'source': 'HM Land Registry PPD + postcodes.io catchment postcode sampling',
        'referencePeriod': reference_period,
        'releaseDate': release_date,
    }

    SOURCE_METADATA_PATH.write_text(json.dumps(payload, indent=2, ensure_ascii=True), encoding='utf-8')


def run(max_workers: int = 8, max_stations: int | None = None) -> dict[str, Any]:
    stations = load_stations(STATIONS_PATH)
    if max_stations is not None:
        stations = stations[:max_stations]

    today = date.today()
    current_start, current_end, prior_start, prior_end = window_dates(today)
    current_window = (current_start, current_end)
    prior_window = (prior_start, prior_end)

    station_postcodes: dict[str, list[dict[str, Any]]] = {}
    all_outcodes: set[str] = set()

    print(f'Fetching catchment postcode samples for {len(stations)} stations...', flush=True)
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {
            executor.submit(
                fetch_nearby_postcodes,
                float(station['lat']),
                float(station['lon']),
            ): station
            for station in stations
        }
        for idx, future in enumerate(as_completed(futures), start=1):
            station = futures[future]
            station_code = str(station['station_code'])
            nearby = future.result()
            selected = stratified_postcode_sample(nearby)
            station_postcodes[station_code] = selected
            all_outcodes.update(str(item['outcode']) for item in selected)
            if idx % 100 == 0:
                print(f'  Postcode samples complete: {idx}/{len(stations)} stations', flush=True)

    print(f'Unique outcodes to query from PPD: {len(all_outcodes)}', flush=True)

    def fetch_window(outcode: str, start: date, end: date) -> tuple[str, dict[str, list[dict[str, Any]]]]:
        rows = fetch_outcode_transactions(outcode, min_date=start, max_date=end)
        return outcode, bucket_transactions_by_postcode(rows)

    current_by_outcode: dict[str, dict[str, list[dict[str, Any]]]] = {}
    prior_by_outcode: dict[str, dict[str, list[dict[str, Any]]]] = {}

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        current_futures = {
            executor.submit(fetch_window, outcode, current_start, current_end): outcode
            for outcode in sorted(all_outcodes)
        }
        for idx, future in enumerate(as_completed(current_futures), start=1):
            outcode, grouped = future.result()
            current_by_outcode[outcode] = grouped
            if idx % 100 == 0:
                print(f'  Current-window outcodes fetched: {idx}/{len(current_futures)}', flush=True)

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        prior_futures = {
            executor.submit(fetch_window, outcode, prior_start, prior_end): outcode
            for outcode in sorted(all_outcodes)
        }
        for idx, future in enumerate(as_completed(prior_futures), start=1):
            outcode, grouped = future.result()
            prior_by_outcode[outcode] = grouped
            if idx % 100 == 0:
                print(f'  Prior-window outcodes fetched: {idx}/{len(prior_futures)}', flush=True)

    output: dict[str, Any] = {}
    for station in stations:
        station_code = str(station['station_code'])
        selected = station_postcodes.get(station_code, [])
        record = build_property_record(
            station,
            current_by_outcode,
            prior_by_outcode,
            selected,
            current_window=current_window,
            prior_window=prior_window,
        )
        if record is not None:
            output[station_code] = record

    OUTPUT_PATH.write_text(json.dumps(output, indent=2, ensure_ascii=True), encoding='utf-8')

    reference_period = (
        f'12-month stratified sample window {current_start.isoformat()} to {current_end.isoformat()} '
        '(with prior-year comparison window for trend proxy)'
    )
    update_source_metadata(reference_period=reference_period, release_date=today.isoformat())

    sample_sizes = [
        len(
            [
                record
                for record in output.values()
                if isinstance(record, dict)
                and record.get('median_semi_price') is not None
            ],
        ),
    ]
    print(
        f'Wrote {len(output)} station property records to {OUTPUT_PATH} '
        f'(stations with usable 12-month sample: {sample_sizes[0]}).',
        flush=True,
    )
    return output


def main() -> None:
    parser = argparse.ArgumentParser(
        description='Generate stratified 12-month semi-detached price metrics per station catchment.',
    )
    parser.add_argument('--max-workers', type=int, default=8)
    parser.add_argument('--max-stations', type=int, default=None)
    args = parser.parse_args()

    run(max_workers=max(1, args.max_workers), max_stations=args.max_stations)


if __name__ == '__main__':
    main()
