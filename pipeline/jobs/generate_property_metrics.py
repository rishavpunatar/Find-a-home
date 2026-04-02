from __future__ import annotations

import argparse
import csv
import io
import json
import math
import re
import statistics
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, timedelta
from pathlib import Path
from typing import Any

from pipeline.jobs.osrm_utils import fetch_json_with_curl_fallback, fetch_text_with_curl_fallback
from pipeline.jobs.station_scope import candidate_scope_station_codes


ROOT = Path(__file__).resolve().parents[2]
RAW_DIR = ROOT / 'data' / 'raw'
STATIONS_PATH = RAW_DIR / 'stations_transport.json'
OUTPUT_PATH = RAW_DIR / 'property_metrics.json'
SOURCE_METADATA_PATH = RAW_DIR / 'source_metadata.json'

POSTCODES_API_URL = 'https://api.postcodes.io/postcodes'
PPD_CSV_URL = 'https://landregistry.data.gov.uk/app/ppd/ppd_data.csv'
OTM_BASE_URL = 'https://www.onthemarket.com'
OTM_NEXT_DATA_PATTERN = re.compile(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>')

PRIMARY_CATCHMENT_RADIUS_M = 800
LISTING_EXTENDED_CATCHMENT_RADIUS_M = 1600
TRANSACTION_EXTENDED_CATCHMENT_RADIUS_M = 5000
POSTCODE_LIMIT_PER_STATION = 350
MAX_POSTCODES_PER_BAND = 40
MAX_TRANSACTIONS_PER_BAND = 60
OTM_TARGET_LISTINGS = 18
OTM_MAX_TOTAL_PAGES = 6
OTM_MAX_PAGES_PER_SLUG = 2
OTM_MIN_LISTINGS_FOR_DIRECT_RECORD = 3
OTM_MAX_LISTING_DISTANCE_M = LISTING_EXTENDED_CATCHMENT_RADIUS_M
OTM_MIN_STATION_SLUG_DISTANCE_M = PRIMARY_CATCHMENT_RADIUS_M

BANDS: list[tuple[str, float, float]] = [
    ('inner', 0.0, 300.0),
    ('middle', 300.0, 550.0),
    ('outer', 550.0, 800.0),
    ('extended_inner', 800.0, 1200.0),
    ('extended_outer', 1200.0, 1600.0),
    ('far_inner', 1600.0, 2600.0),
    ('far_middle', 2600.0, 3800.0),
    ('far_outer', 3800.0, 5000.0),
]

BAND_PRICE_WEIGHTS: dict[str, float] = {
    'inner': 1.35,
    'middle': 1.0,
    'outer': 0.75,
    'extended_inner': 0.58,
    'extended_outer': 0.44,
    'far_inner': 0.33,
    'far_middle': 0.24,
    'far_outer': 0.16,
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


def slugify_location_name(raw_name: str) -> str:
    normalized = raw_name.lower().replace('&', ' and ')
    normalized = normalized.replace("'", '')
    normalized = normalized.replace('.', '')
    normalized = re.sub(r'\([^)]*\)', ' ', normalized)
    normalized = re.sub(r'[^a-z0-9]+', '-', normalized)
    return normalized.strip('-')


def tokenize_location_name(raw_name: str) -> list[str]:
    return [token for token in re.split(r'[^a-z0-9]+', raw_name.lower()) if token]


def build_location_slug_candidates(station: dict[str, Any]) -> list[str]:
    raw_name = str(station['station_name']).strip()
    local_authority = str(station.get('local_authority') or '').strip()
    county_or_borough = str(station.get('county_or_borough') or '').strip()

    tokens = tokenize_location_name(raw_name)
    candidate_names: list[str] = [raw_name]
    stopwords = {
        'and',
        'the',
        'station',
        'rail',
        'underground',
        'dlr',
    }
    generic_single_tokens = {
        'east',
        'west',
        'north',
        'south',
        'road',
        'lane',
        'street',
        'bridge',
        'park',
        'hill',
        'hale',
        'water',
        'green',
    }

    if len(tokens) > 1:
        headless = ' '.join(tokens[1:])
        tailless = ' '.join(tokens[:-1])
        inner = ' '.join(tokens[1:-1])
        candidate_names.extend([headless, tailless, inner])

    if local_authority:
        candidate_names.append(local_authority)
    if county_or_borough and county_or_borough.lower() != 'greater london':
        candidate_names.append(county_or_borough)

    slugs: list[str] = []
    seen: set[str] = set()
    for candidate in candidate_names:
        candidate_tokens = tokenize_location_name(candidate)
        if not candidate_tokens:
            continue
        if all(token in stopwords for token in candidate_tokens):
            continue
        if len(candidate_tokens) == 1 and candidate_tokens[0] in generic_single_tokens:
            continue
        slug = slugify_location_name(candidate)
        if not slug or slug in seen:
            continue
        seen.add(slug)
        slugs.append(slug)
    return slugs


def parse_price_to_number(raw_price: str | None) -> float | None:
    if not raw_price:
        return None
    normalized = raw_price.strip().lower().replace(',', '').replace('£', '')
    multiplier = 1.0
    if normalized.endswith('m'):
        multiplier = 1_000_000.0
        normalized = normalized[:-1]
    elif normalized.endswith('k'):
        multiplier = 1_000.0
        normalized = normalized[:-1]
    try:
        return float(normalized) * multiplier
    except ValueError:
        return None


def fetch_otm_page_results(location_slug: str, page: int) -> tuple[list[dict[str, Any]], int | None]:
    response_text = fetch_text_with_curl_fallback(
        f'{OTM_BASE_URL}/for-sale/property/{location_slug}/',
        params={'page': page},
        timeout_seconds=12,
        headers={'User-Agent': 'Mozilla/5.0'},
        cache_namespace='property-otm-pages',
        cache_ttl_hours=24 * 3,
    )
    if not response_text:
        return [], None

    match = OTM_NEXT_DATA_PATTERN.search(response_text)
    if not match:
        return [], None

    try:
        payload = json.loads(match.group(1))
    except json.JSONDecodeError:
        return [], None

    state = payload.get('props', {}).get('initialReduxState', {})
    results = state.get('results', {})
    listings = results.get('list')
    total_results = results.get('totalResults')
    if not isinstance(listings, list):
        return [], None
    return listings, int(total_results) if isinstance(total_results, int) else None


def filter_otm_listings(
    listings: list[dict[str, Any]],
    *,
    station_lat: float,
    station_lon: float,
    max_distance_m: float = OTM_MAX_LISTING_DISTANCE_M,
) -> list[dict[str, Any]]:
    selected: list[dict[str, Any]] = []
    seen_ids: set[str] = set()

    for listing in listings:
        if not isinstance(listing, dict):
            continue
        listing_id = listing.get('id')
        if not isinstance(listing_id, str) or listing_id in seen_ids:
            continue

        property_type = str(listing.get('humanised-property-type') or '').lower()
        bedrooms = listing.get('bedrooms')
        bathrooms = listing.get('bathrooms')
        location = listing.get('location') or {}
        lat = location.get('lat')
        lon = location.get('lon')
        price = parse_price_to_number(str(listing.get('price') or listing.get('short-price') or ''))

        if 'semi-detached' not in property_type and 'semi detached' not in property_type:
            continue
        if not isinstance(bedrooms, int) or bedrooms < 3:
            continue
        if not isinstance(bathrooms, int) or bathrooms < 2:
            continue
        if price is None or not isinstance(lat, (int, float)) or not isinstance(lon, (int, float)):
            continue

        distance_m = haversine_distance_m(station_lat, station_lon, float(lat), float(lon))
        if distance_m > max_distance_m:
            continue

        seen_ids.add(listing_id)
        selected.append(
            {
                'id': listing_id,
                'price': price,
                'distance_m': distance_m,
            },
        )

    return selected


def listing_distance_weight(distance_m: float) -> float:
    return 1.0 / max(350.0, distance_m) ** 0.35


def fetch_live_listing_sample(station: dict[str, Any]) -> tuple[list[dict[str, Any]], int, list[str]]:
    station_lat = float(station['lat'])
    station_lon = float(station['lon'])

    listings: list[dict[str, Any]] = []
    pages_scanned = 0
    matched_slugs: list[str] = []
    candidate_slugs = build_location_slug_candidates(station)
    for location_slug in candidate_slugs:
        max_distance_m = (
            OTM_MIN_STATION_SLUG_DISTANCE_M
            if location_slug == slugify_location_name(str(station['station_name']))
            else OTM_MAX_LISTING_DISTANCE_M
        )
        total_pages = OTM_MAX_PAGES_PER_SLUG
        for page in range(1, OTM_MAX_PAGES_PER_SLUG + 1):
            page_results, total_results = fetch_otm_page_results(location_slug, page)
            pages_scanned += 1
            if not page_results and total_results in (None, 0):
                break
            filtered = filter_otm_listings(
                page_results,
                station_lat=station_lat,
                station_lon=station_lon,
                max_distance_m=max_distance_m,
            )
            if filtered:
                matched_slugs.append(location_slug)
                listings.extend(filtered)
            if total_results is not None:
                total_pages = min(OTM_MAX_PAGES_PER_SLUG, max(1, math.ceil(total_results / 30)))
            if (
                len(listings) >= OTM_TARGET_LISTINGS
                or page >= total_pages
                or pages_scanned >= OTM_MAX_TOTAL_PAGES
            ):
                break
        if len(listings) >= OTM_TARGET_LISTINGS or pages_scanned >= OTM_MAX_TOTAL_PAGES:
            break

    listings.sort(key=lambda item: (item['distance_m'], item['price']))
    deduped: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    for listing in listings:
        if listing['id'] in seen_ids:
            continue
        seen_ids.add(listing['id'])
        deduped.append(listing)

    matched_slug_deduped: list[str] = []
    seen_slugs: set[str] = set()
    for slug in matched_slugs:
        if slug in seen_slugs:
            continue
        seen_slugs.add(slug)
        matched_slug_deduped.append(slug)

    return deduped, pages_scanned, matched_slug_deduped


def build_live_listing_property_record(
    station: dict[str, Any],
    *,
    snapshot_date: date,
) -> dict[str, Any] | None:
    live_listings, pages_scanned, matched_slugs = fetch_live_listing_sample(station)
    if len(live_listings) < OTM_MIN_LISTINGS_FOR_DIRECT_RECORD:
        return None

    prices = [float(item['price']) for item in live_listings]
    weights = [listing_distance_weight(float(item['distance_m'])) for item in live_listings]
    median_price = weighted_median(prices, weights)
    average_price = weighted_mean(prices, weights)
    max_distance_used = max(float(item['distance_m']) for item in live_listings)
    used_extended_radius = max_distance_used > PRIMARY_CATCHMENT_RADIUS_M

    simple_price_score = price_score(median_price)

    confidence = 0.47 if used_extended_radius else 0.52
    confidence += min(0.26, len(live_listings) / 20 * 0.26)
    confidence += 0.1 if len(live_listings) >= 8 else 0.0
    confidence = round(clamp(confidence, 0.45, 0.9), 3)
    status = 'available'

    methodology_note = (
        'Current OnTheMarket asking-price snapshot for the locality generated from public search results. '
        'Listings are filtered client-side to semi-detached homes with at least 3 bedrooms and 2 bathrooms. '
        'Median/average ask prices are lightly distance-weighted back to the station area using listing coordinates. '
        f'Run date {snapshot_date.isoformat()}, pages scanned={pages_scanned}, qualifying listings={len(live_listings)}, '
        f'matched location slugs={matched_slugs or ["none"]}, max listing distance={round(max_distance_used)}m.'
    )

    return {
        'average_semi_price': round(average_price, 2),
        'median_semi_price': round(median_price, 2),
        'price_trend_pct_5y': None,
        'price_score': simple_price_score,
        'status': status,
        'confidence': confidence,
        'provenance': 'direct_listing_extended' if used_extended_radius else 'direct_listing',
        'methodology_note': methodology_note,
    }


def fetch_nearby_postcodes(lat: float, lon: float, *, radius_m: float) -> list[dict[str, Any]]:
    payload = fetch_json_with_curl_fallback(
        POSTCODES_API_URL,
        params={
            'lat': f'{lat:.6f}',
            'lon': f'{lon:.6f}',
            'radius': int(radius_m),
            'limit': POSTCODE_LIMIT_PER_STATION,
        },
        timeout_seconds=25,
        cache_namespace='property-postcodes-io',
        cache_ttl_hours=24 * 14,
    )
    if not isinstance(payload, dict):
        return []
    result = payload.get('result')
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


def stratified_postcode_sample(postcodes: list[dict[str, Any]], *, allowed_bands: tuple[str, ...]) -> list[dict[str, Any]]:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in postcodes:
        band = str(row['band'])
        if band not in allowed_bands:
            continue
        grouped[band].append(row)

    for rows in grouped.values():
        rows.sort(key=lambda item: (float(item['distance_m']), str(item['postcode'])))

    selected: list[dict[str, Any]] = []
    selected_postcodes: set[str] = set()
    for band_name in allowed_bands:
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
            text = fetch_text_with_curl_fallback(
                PPD_CSV_URL,
                params=params,
                timeout_seconds=45,
                cache_namespace='property-land-registry-ppd',
                cache_ttl_hours=24 * 14,
            )
            if not text:
                raise RuntimeError('No PPD response body returned')
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


def distance_weight(distance_m: float, normalization_radius_m: float) -> float:
    normalized = clamp(distance_m / max(normalization_radius_m, 1.0), 0.0, 1.0)
    return 0.75 + (1.0 - normalized) * 0.5


def recency_weight(*, deed_date: date | None, window_end: date) -> float:
    if deed_date is None:
        return 1.0

    age_days = clamp(float((window_end - deed_date).days), 0.0, 540.0)
    freshness = 1.0 - age_days / 540.0
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


def price_score(median_price: float) -> float:
    # Lower prices score higher; range tuned to semi-detached market in target region.
    return round(clamp(100 * (1 - (median_price - 250_000) / (1_300_000 - 250_000)), 0, 100), 2)


def build_property_record(
    station: dict[str, Any],
    current_by_outcode: dict[str, dict[str, list[dict[str, Any]]]],
    prior_by_outcode: dict[str, dict[str, list[dict[str, Any]]]],
    selected_postcodes: list[dict[str, Any]],
    *,
    current_window: tuple[date, date],
    prior_window: tuple[date, date],
    provenance: str,
    radius_m: float,
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
            distance_m = float(postcode_meta.get('distance_m', radius_m * 0.7))
            band_weight = BAND_PRICE_WEIGHTS.get(band, 1.0)
            deed = parse_deed_date(str(row.get('deed_date', '')))
            weight = band_weight * distance_weight(distance_m, radius_m) * recency_weight(
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

    selected_band_names = {str(item['band']) for item in selected_postcodes}
    band_coverage = sum(1 for band_name, value in current_strata.items() if band_name in selected_band_names and value > 0)
    sample_size = len(prices)
    status = 'available'

    is_extended = provenance.endswith('_extended')
    is_far = provenance.endswith('_far')
    confidence = 0.2 if is_far else 0.28 if is_extended else 0.32
    confidence += min(0.38, sample_size / 80 * 0.38)
    confidence += (band_coverage / max(1, len(selected_band_names))) * 0.16
    confidence += 0.08 if trend_proxy is not None else 0.0
    confidence = round(clamp(confidence, 0.18 if is_far else 0.22 if is_extended else 0.25, 0.92), 3)

    simple_price_score = price_score(median_price)

    current_start, current_end = current_window
    prior_start, prior_end = prior_window
    methodology_note = (
        'Fallback property metric when current 3-bed / 2-bath asking-price coverage is too thin. '
        'HM Land Registry PPD semi-detached standard transactions. '
        f'Catchment postcode sample from postcodes.io within {int(radius_m)}m '
        'using capped distance bands with lower weights for outer rings. '
        'Median/average are distance-and-recency weighted so nearer catchment transactions and '
        'newer sales have higher influence (band weights taper from the inner catchment into the outer fallback rings). '
        f'Current window {current_start.isoformat()} to {current_end.isoformat()}; '
        f'prior window {prior_start.isoformat()} to {prior_end.isoformat()} for trend proxy. '
        f'Sample transactions={sample_size}, postcodes with transactions={postcode_hits}, '
        f'strata={current_strata}.'
    )

    return {
        'average_semi_price': round(average_price, 2),
        'median_semi_price': round(median_price, 2),
        'price_trend_pct_5y': None if trend_proxy is None else round(float(trend_proxy), 3),
        'price_score': simple_price_score,
        'status': status,
        'confidence': confidence,
        'provenance': provenance,
        'methodology_note': methodology_note,
    }


def update_source_metadata(reference_period: str, release_date: str) -> None:
    payload: dict[str, Any] = {}
    if SOURCE_METADATA_PATH.exists():
        existing = json.loads(SOURCE_METADATA_PATH.read_text(encoding='utf-8'))
        if isinstance(existing, dict):
            payload = existing

    payload['property'] = {
        'source': 'OnTheMarket current asking-price snapshot + HM Land Registry PPD fallback',
        'referencePeriod': reference_period,
        'releaseDate': release_date,
    }

    SOURCE_METADATA_PATH.write_text(json.dumps(payload, indent=2, ensure_ascii=True), encoding='utf-8')


def run(max_workers: int = 8, max_stations: int | None = None) -> dict[str, Any]:
    stations = load_stations(STATIONS_PATH)
    scope_station_codes = candidate_scope_station_codes()
    stations = [station for station in stations if str(station.get('station_code')) in scope_station_codes]
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
                radius_m=TRANSACTION_EXTENDED_CATCHMENT_RADIUS_M,
            ): station
            for station in stations
        }
        for idx, future in enumerate(as_completed(futures), start=1):
            station = futures[future]
            station_code = str(station['station_code'])
            nearby = future.result()
            station_postcodes[station_code] = nearby
            all_outcodes.update(str(item['outcode']) for item in nearby)
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
    def build_station_record(station: dict[str, Any]) -> tuple[str, dict[str, Any] | None]:
        station_code = str(station['station_code'])
        nearby_postcodes = station_postcodes.get(station_code, [])
        primary_selected = stratified_postcode_sample(
            nearby_postcodes,
            allowed_bands=('inner', 'middle', 'outer'),
        )
        extended_selected = stratified_postcode_sample(
            nearby_postcodes,
            allowed_bands=('inner', 'middle', 'outer', 'extended_inner', 'extended_outer'),
        )
        far_selected = stratified_postcode_sample(
            nearby_postcodes,
            allowed_bands=(
                'inner',
                'middle',
                'outer',
                'extended_inner',
                'extended_outer',
                'far_inner',
                'far_middle',
                'far_outer',
            ),
        )
        record = build_live_listing_property_record(station, snapshot_date=today)
        if record is None:
            record = build_property_record(
                station,
                current_by_outcode,
                prior_by_outcode,
                primary_selected,
                current_window=current_window,
                prior_window=prior_window,
                provenance='direct_transactions',
                radius_m=PRIMARY_CATCHMENT_RADIUS_M,
            )
        if record is None:
            record = build_property_record(
                station,
                current_by_outcode,
                prior_by_outcode,
                extended_selected,
                current_window=current_window,
                prior_window=prior_window,
                provenance='direct_transactions_extended',
                radius_m=LISTING_EXTENDED_CATCHMENT_RADIUS_M,
            )
        if record is None:
            record = build_property_record(
                station,
                current_by_outcode,
                prior_by_outcode,
                far_selected,
                current_window=current_window,
                prior_window=prior_window,
                provenance='direct_transactions_far',
                radius_m=TRANSACTION_EXTENDED_CATCHMENT_RADIUS_M,
            )
        return station_code, record

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = [executor.submit(build_station_record, station) for station in stations]
        for idx, future in enumerate(as_completed(futures), start=1):
            station_code, record = future.result()
            if record is not None:
                output[station_code] = record
            if idx % 100 == 0 or idx == len(futures):
                print(f'  Property records built: {idx}/{len(futures)}', flush=True)

    OUTPUT_PATH.write_text(json.dumps(output, indent=2, ensure_ascii=True), encoding='utf-8')

    reference_period = (
        f'Current 2026 OnTheMarket asking-price snapshot on {today.isoformat()} for semi-detached homes with 3+ bedrooms and 2+ bathrooms; '
        f'fallback uses HM Land Registry 12-month stratified transaction window {current_start.isoformat()} to {current_end.isoformat()} '
        'with a local 800m catchment first, a 1600m extended-area fallback, and then a lower-confidence outer transaction ring up to 5000m when the nearer sample is too sparse '
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
