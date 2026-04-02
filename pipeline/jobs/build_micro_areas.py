from __future__ import annotations

import json
import math
import os
import re
from dataclasses import asdict
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from pipeline.adapters.crime_adapter import FixtureCrimeAdapter
from pipeline.adapters.green_space_adapter import FixtureGreenSpaceAdapter
from pipeline.adapters.pollution_adapter import FixturePollutionAdapter
from pipeline.adapters.population_adapter import FixturePopulationAdapter
from pipeline.adapters.property_adapter import FixturePropertyAdapter
from pipeline.adapters.school_adapter import FixtureSchoolAdapter
from pipeline.adapters.station_transport_adapter import FixtureStationTransportAdapter
from pipeline.adapters.transport_metrics_adapter import FixtureTransportMetricsAdapter
from pipeline.adapters.wellbeing_adapter import FixtureWellbeingAdapter
from pipeline.jobs.validate_dataset import generate_quality_report, write_quality_report
from pipeline.jobs.verify_data_sources import generate_verification_report, write_report
from pipeline.models.entities import Coordinate, NumericMetric, SearchConfig, StationRecord
from pipeline.models.scoring import clamp, forward_score, inverse_score, mean, weighted_score


ROOT = Path(__file__).resolve().parents[2]
RAW_DIR = ROOT / 'data' / 'raw'
PROCESSED_DIR = ROOT / 'data' / 'processed'
CONFIG_PATH = ROOT / 'pipeline' / 'config' / 'search_config.json'
SOURCE_METADATA_PATH = RAW_DIR / 'source_metadata.json'
TRANSPORT_METRICS_PATH = RAW_DIR / 'transport_metrics.json'
LONDON_WIDE_MAX_COMMUTE_MINUTES = 60
GREEN_COVER_EXPANDED_RADIUS_MULTIPLIER = 2.0
MAX_ANCHOR_DISTANCE_FOR_ESTIMATION_KM = 15.0

EXCLUDED_STATION_NAME_PATTERNS = [
    re.compile(pattern, re.IGNORECASE)
    for pattern in (
        r'\bminiature\b',
        r'\bheritage\b',
        r'\btramway\b',
        r'\bfunicular\b',
        r'\bmodel railway\b',
        r'\bpark station\b',
        r'\brailway museum\b',
        r'\bjunction railway\b',
        r'\bhalt\b',
        r'\baquarium\b',
        r'\btheme park\b',
    )
]


def load_config(path: Path) -> SearchConfig:
    payload = json.loads(path.read_text(encoding='utf-8'))
    central_coordinate_payload = payload.get(
        'central_london_coordinate',
        {'lat': 51.5152, 'lon': -0.1419},
    )
    return SearchConfig(
        methodology_version=payload['methodology_version'],
        generated_timezone=payload['generated_timezone'],
        pinner_coordinate=Coordinate(
            lat=payload['pinner_coordinate']['lat'],
            lon=payload['pinner_coordinate']['lon'],
        ),
        central_london_coordinate=Coordinate(
            lat=central_coordinate_payload['lat'],
            lon=central_coordinate_payload['lon'],
        ),
        station_search_radius_km=payload['station_search_radius_km'],
        micro_area_walk_radius_m=payload['micro_area_walk_radius_m'],
        max_commute_minutes=payload['candidate_filter']['max_commute_minutes'],
        max_drive_minutes_to_pinner=payload['candidate_filter']['max_drive_minutes_to_pinner'],
        station_distance_threshold_m=payload['dedupe']['station_distance_threshold_m'],
        destination_station=payload['destination_station'],
        default_weights=payload['default_weights'],
        last_updated_default=payload['last_updated_default'],
    )


def load_source_metadata(path: Path) -> dict[str, dict[str, str]]:
    if not path.exists():
        return {}
    payload = json.loads(path.read_text(encoding='utf-8'))
    return payload if isinstance(payload, dict) else {}


def source_date(metadata: dict[str, dict[str, str]], domain: str, fallback: str) -> str:
    record = metadata.get(domain, {})
    value = record.get('releaseDate') or record.get('referencePeriod')
    if isinstance(value, str) and value.strip():
        return value.strip()
    return fallback


def station_exclusion_reason(station: StationRecord) -> str | None:
    name = station.station_name.strip()
    lower_name = name.lower()
    for pattern in EXCLUDED_STATION_NAME_PATTERNS:
        if pattern.search(lower_name):
            return f'Name pattern excluded: {pattern.pattern}'

    if station.local_authority.strip().lower() == 'unknown':
        return 'Local authority unresolved'
    if station.county_or_borough.strip().lower() == 'unknown':
        return 'County/borough unresolved'
    return None


def sanitize_station_universe(stations: list[StationRecord]) -> tuple[list[StationRecord], list[dict[str, str]]]:
    kept: list[StationRecord] = []
    excluded: list[dict[str, str]] = []

    for station in stations:
        reason = station_exclusion_reason(station)
        if reason:
            excluded.append(
                {
                    'stationCode': station.station_code,
                    'stationName': station.station_name,
                    'reason': reason,
                },
            )
            continue
        kept.append(station)

    return kept, excluded


def haversine_distance_m(a: Coordinate, b: Coordinate) -> float:
    from math import asin, cos, radians, sin, sqrt

    radius_m = 6_371_000
    lat_1 = radians(a.lat)
    lon_1 = radians(a.lon)
    lat_2 = radians(b.lat)
    lon_2 = radians(b.lon)

    d_lat = lat_2 - lat_1
    d_lon = lon_2 - lon_1

    h = sin(d_lat / 2) ** 2 + cos(lat_1) * cos(lat_2) * sin(d_lon / 2) ** 2
    return radius_m * 2 * asin(sqrt(h))


def metric(
    value: float | None,
    unit: str,
    status: str,
    confidence: float,
    provenance: str,
    note: str,
    last_updated: str,
) -> NumericMetric:
    return NumericMetric(
        value=None if value is None else float(value),
        unit=unit,
        status=status,
        confidence=confidence,
        provenance=provenance,
        methodology_note=note,
        last_updated=last_updated,
    )


def metric_from_record(
    record: dict[str, Any] | None,
    key: str,
    *,
    unit: str,
    note: str,
    last_updated: str,
    fallback_value: float | None = None,
    fallback_status: str = 'missing',
    fallback_confidence: float = 0.2,
    fallback_provenance: str = 'missing',
) -> NumericMetric:
    if record is None or record.get(key) is None:
        return metric(
            fallback_value,
            unit,
            fallback_status,
            fallback_confidence,
            fallback_provenance,
            note,
            last_updated,
        )

    field_statuses = record.get('field_statuses') if isinstance(record.get('field_statuses'), dict) else {}
    field_confidences = (
        record.get('field_confidences') if isinstance(record.get('field_confidences'), dict) else {}
    )
    field_provenance = (
        record.get('field_provenance') if isinstance(record.get('field_provenance'), dict) else {}
    )

    return metric(
        record.get(key),
        unit,
        str(field_statuses.get(key, record.get('status', 'estimated'))),
        float(field_confidences.get(key, record.get('confidence', fallback_confidence))),
        str(field_provenance.get(key, record.get('provenance', 'direct'))),
        str(record.get('methodology_note', note)),
        last_updated,
    )


def nearest_anchor_samples(
    target: StationRecord,
    stations_by_code: dict[str, StationRecord],
    anchor_records: dict[str, dict[str, Any]],
    *,
    limit: int = 8,
) -> list[tuple[float, dict[str, Any]]]:
    samples: list[tuple[float, dict[str, Any]]] = []

    for station_code, record in anchor_records.items():
        anchor_station = stations_by_code.get(station_code)
        if not anchor_station:
            continue

        distance_m = haversine_distance_m(target.coordinate, anchor_station.coordinate)
        samples.append((distance_m, record))

    samples.sort(key=lambda item: item[0])
    return samples[:limit]


def idw_interpolate_value(
    samples: list[tuple[float, dict[str, Any]]],
    key: str,
    *,
    power: float = 1.8,
    min_distance_m: float = 120.0,
) -> float | None:
    weighted_sum = 0.0
    weight_total = 0.0

    for distance_m, record in samples:
        value = record.get(key)
        if value is None:
            continue

        safe_distance = max(distance_m, min_distance_m)
        weight = 1.0 / (safe_distance**power)
        weighted_sum += float(value) * weight
        weight_total += weight

    if weight_total == 0:
        return None

    return weighted_sum / weight_total


def interpolated_confidence(samples: list[tuple[float, dict[str, Any]]]) -> float:
    if not samples:
        return 0.25

    nearest_distance_km = samples[0][0] / 1000.0
    distance_factor = math.exp(-nearest_distance_km / 18.0)
    anchor_confidence = mean([float(record.get('confidence', 0.6)) for _, record in samples])

    return round(clamp(0.28 + 0.42 * distance_factor + 0.2 * (anchor_confidence - 0.5), 0.2, 0.75), 3)


def synthesize_record_from_anchors(
    target: StationRecord,
    stations_by_code: dict[str, StationRecord],
    anchor_records: dict[str, dict[str, Any]],
    value_keys: list[str],
    methodology_note: str,
) -> dict[str, Any] | None:
    samples = nearest_anchor_samples(target, stations_by_code, anchor_records)
    if not samples:
        return None
    nearest_distance_km = samples[0][0] / 1000.0
    if nearest_distance_km > MAX_ANCHOR_DISTANCE_FOR_ESTIMATION_KM:
        return None

    synthesized: dict[str, Any] = {}
    for key in value_keys:
        value = idw_interpolate_value(samples, key)
        if value is None:
            return None
        synthesized[key] = round(float(value), 3)

    synthesized['status'] = 'estimated'
    synthesized['confidence'] = interpolated_confidence(samples)
    synthesized['provenance'] = 'interpolated'
    synthesized['methodology_note'] = methodology_note
    return synthesized


def synthesize_crime_breakdown(
    crime_rate: float,
    target: StationRecord,
    stations_by_code: dict[str, StationRecord],
    crime_records: dict[str, dict[str, Any]],
) -> dict[str, float]:
    samples = nearest_anchor_samples(target, stations_by_code, crime_records, limit=10)
    if not samples:
        return {}

    categories = ['violence', 'theft', 'vehicle', 'other']
    weighted_props = {category: 0.0 for category in categories}
    weight_total = 0.0

    for distance_m, record in samples:
        breakdown = record.get('breakdown')
        if not isinstance(breakdown, dict):
            continue

        total = sum(float(breakdown.get(category, 0.0)) for category in categories)
        if total <= 0:
            continue

        weight = 1.0 / (max(distance_m, 120.0) ** 1.6)
        weight_total += weight

        for category in categories:
            weighted_props[category] += (float(breakdown.get(category, 0.0)) / total) * weight

    if weight_total == 0:
        return {}

    proportions = {category: weighted_props[category] / weight_total for category in categories}
    return {category: round(max(0.0, crime_rate * proportion), 1) for category, proportion in proportions.items()}


def transport_metric_or_fallback(
    station: StationRecord,
    transport_records: dict[str, dict[str, Any]],
    key: str,
) -> float:
    record = transport_records.get(station.station_code)
    raw_value = (record or {}).get(key)
    if isinstance(raw_value, (int, float)):
        return float(raw_value)

    fallback_mapping = {
        'typical_commute_min': station.typical_commute_min,
        'peak_commute_min': station.peak_commute_min,
        'offpeak_commute_min': station.offpeak_commute_min,
        'peak_tph': station.peak_tph,
        'interchange_count': float(station.interchange_count),
        'drive_to_pinner_min': station.drive_to_pinner_min,
    }
    return float(fallback_mapping[key])


def candidate_filter(
    stations: list[StationRecord],
    config: SearchConfig,
    transport_records: dict[str, dict[str, Any]],
) -> list[StationRecord]:
    return [
        station
        for station in stations
        if transport_metric_or_fallback(station, transport_records, 'typical_commute_min')
        <= config.max_commute_minutes
    ]


def dedupe_micro_areas(stations: list[StationRecord], threshold_m: float) -> list[StationRecord]:
    priority_sorted = sorted(
        stations,
        key=lambda station: (
            station.typical_commute_min
            + station.peak_commute_min * 0.18
            + station.interchange_count * 2.5
            - station.peak_tph * 0.6,
            station.station_name,
        ),
    )

    selected: list[StationRecord] = []

    for station in priority_sorted:
        overlaps_existing = False
        for existing in selected:
            distance = haversine_distance_m(station.coordinate, existing.coordinate)
            shared_lines = bool(set(station.lines).intersection(existing.lines))
            if distance < threshold_m and shared_lines:
                overlaps_existing = True
                break

        if not overlaps_existing:
            selected.append(station)

    return selected


def overlap_confidence(station: StationRecord, all_stations: list[StationRecord], catchment_radius_m: int) -> float:
    neighbours = [
        haversine_distance_m(station.coordinate, other.coordinate)
        for other in all_stations
        if other.station_code != station.station_code
    ]

    if not neighbours:
        return 1.0

    nearest = min(neighbours)
    confidence = min(1.0, nearest / (2 * catchment_radius_m))
    return round(confidence, 3)


def quantile(sorted_values: list[float], q: float) -> float:
    if not sorted_values:
        raise ValueError('sorted_values must be non-empty')
    index = int(round((len(sorted_values) - 1) * clamp(q, 0.0, 1.0)))
    return float(sorted_values[index])


def crime_score_bounds(crime_records: dict[str, dict[str, Any]]) -> tuple[float, float]:
    direct_rates = sorted(
        float(record['crime_rate_per_1000'])
        for record in crime_records.values()
        if isinstance(record, dict) and isinstance(record.get('crime_rate_per_1000'), (int, float))
    )
    if not direct_rates:
        return (25.0, 130.0)

    best = max(1.0, direct_rates[0])
    worst = max(best + 1.0, quantile(direct_rates, 0.95))
    return (best, worst)


def log_inverse_score(value: float, *, best: float, worst: float) -> float:
    safe_value = max(value, best)
    safe_best = max(best, 1e-6)
    safe_worst = max(worst, safe_best * 1.0001)
    numerator = math.log(safe_value) - math.log(safe_best)
    denominator = math.log(safe_worst) - math.log(safe_best)
    if denominator <= 0:
        return 0.0
    return clamp(100.0 * (1.0 - numerator / denominator), 0.0, 100.0)


def score_components(
    station: StationRecord,
    transport: dict[str, Any] | None,
    price: dict[str, Any] | None,
    schools: dict[str, Any] | None,
    population: dict[str, Any] | None,
    pollution: dict[str, Any] | None,
    green: dict[str, Any] | None,
    crime: dict[str, Any] | None,
    *,
    crime_scale_bounds: tuple[float, float],
) -> dict[str, float]:
    default_population_denominator = 25_650.0

    def number_or_default(record: dict[str, Any] | None, key: str, default: float) -> float:
        if not record:
            return float(default)
        value = record.get(key)
        return float(value) if isinstance(value, (int, float)) else float(default)

    def per_10k(value: float, population_denominator: float) -> float | None:
        if population_denominator <= 0:
            return None
        return (value / population_denominator) * 10_000

    commute_typical = (
        float(transport.get('typical_commute_min'))
        if transport and transport.get('typical_commute_min') is not None
        else float(station.typical_commute_min)
    )
    commute_peak = (
        float(transport.get('peak_commute_min'))
        if transport and transport.get('peak_commute_min') is not None
        else float(station.peak_commute_min)
    )
    peak_tph = (
        float(transport.get('peak_tph'))
        if transport and transport.get('peak_tph') is not None
        else float(station.peak_tph)
    )
    interchange_count = (
        float(transport.get('interchange_count'))
        if transport and transport.get('interchange_count') is not None
        else float(station.interchange_count)
    )
    value_score = number_or_default(price, 'price_score', 45)

    commute_score = inverse_score(commute_typical, best=20, worst=60)
    peak_score = inverse_score(commute_peak, best=22, worst=70)
    frequency_score = forward_score(peak_tph, min_value=4, max_value=18)
    interchange_score = inverse_score(interchange_count, best=0, worst=3)
    transport_score = mean([
        commute_score * 0.30,
        peak_score * 0.2,
        frequency_score * 0.3,
        interchange_score * 0.2,
    ]) * (1 / 0.25)

    primary_quality = number_or_default(schools, 'primary_quality_score', 50)
    primary_attendance = number_or_default(schools, 'primary_attendance_score', 50)
    primary_ofsted_penalty = number_or_default(schools, 'primary_ofsted_penalty', 0)
    primary_count = number_or_default(schools, 'nearby_primary_count', 0)
    population_denominator = number_or_default(
        population,
        'population_in_reference_zone',
        default_population_denominator,
    )
    primary_count_per_10k = per_10k(primary_count, population_denominator) or 0.0
    school_access_score = forward_score(primary_count_per_10k, min_value=18, max_value=90)
    schools_score = (
        primary_quality * 0.68
        + school_access_score * 0.22
        + primary_attendance * 0.10
        - primary_ofsted_penalty
    )

    no2 = number_or_default(pollution, 'annual_no2', 30)
    pm25 = number_or_default(pollution, 'annual_pm25', 14)
    green_cover = number_or_default(green, 'green_cover_pct', 20)
    green_area = number_or_default(green, 'green_space_area_km2_within_1km', 0.8)
    park_distance = number_or_default(green, 'nearest_park_distance_m', 900)
    environment_score = (
        inverse_score(pm25, 7, 18) * 0.34
        + inverse_score(no2, 10, 40) * 0.16
        + forward_score(green_cover, 10, 62) * 0.2
        + forward_score(green_area, 0.3, 3.2) * 0.18
        + inverse_score(park_distance, 120, 1500) * 0.12
    )

    crime_rate = number_or_default(crime, 'crime_rate_per_1000', 95)
    crime_score = log_inverse_score(
        crime_rate,
        best=crime_scale_bounds[0],
        worst=crime_scale_bounds[1],
    )

    return {
        'value': round(clamp(value_score), 1),
        'transport': round(clamp(transport_score), 1),
        'schools': round(clamp(schools_score), 1),
        'environment': round(clamp(environment_score), 1),
        'crime': round(clamp(crime_score), 1),
    }


def confidence_score(metrics: list[NumericMetric], overlap_conf: float) -> float:
    return round(clamp(mean([metric_item.confidence for metric_item in metrics] + [overlap_conf]), 0.0, 1.0), 3)


def ranking_rules(component_scores: dict[str, float]) -> list[str]:
    labels = {
        'value': 'price',
        'transport': 'transport',
        'schools': 'school quality and access',
        'environment': 'air quality and green space',
        'crime': 'safety',
    }

    ranked_keys = ['value', 'transport', 'schools', 'environment', 'crime']
    sorted_pairs = sorted(
        [(key, component_scores[key]) for key in ranked_keys],
        key=lambda item: item[1],
        reverse=True,
    )
    strengths = sorted_pairs[:2]
    weaknesses = sorted_pairs[-2:]

    return [
        f"Strong {labels[strengths[0][0]]} score ({strengths[0][1]:.1f}) improves rank.",
        f"Strong {labels[strengths[1][0]]} score ({strengths[1][1]:.1f}) supports rank stability.",
        f"Lower {labels[weaknesses[0][0]]} score ({weaknesses[0][1]:.1f}) drags the overall rank.",
        f"Lower {labels[weaknesses[1][0]]} score ({weaknesses[1][1]:.1f}) limits upside.",
    ]


def compile_micro_areas(config: SearchConfig) -> dict[str, Any]:
    source_metadata = load_source_metadata(SOURCE_METADATA_PATH)
    property_last_updated = source_date(source_metadata, 'property', config.last_updated_default)
    schools_last_updated = source_date(source_metadata, 'schools', config.last_updated_default)
    pollution_last_updated = source_date(source_metadata, 'pollution', config.last_updated_default)
    green_last_updated = source_date(source_metadata, 'greenSpace', config.last_updated_default)
    crime_last_updated = source_date(source_metadata, 'crime', config.last_updated_default)
    transport_last_updated = source_date(source_metadata, 'transport', config.last_updated_default)

    station_adapter = FixtureStationTransportAdapter(RAW_DIR / 'stations_transport.json')
    transport_adapter = (
        FixtureTransportMetricsAdapter(TRANSPORT_METRICS_PATH)
        if TRANSPORT_METRICS_PATH.exists()
        else None
    )
    property_adapter = FixturePropertyAdapter(RAW_DIR / 'property_metrics.json')
    school_adapter = FixtureSchoolAdapter(RAW_DIR / 'schools_metrics.json')
    pollution_adapter = FixturePollutionAdapter(RAW_DIR / 'pollution_metrics.json')
    green_adapter = FixtureGreenSpaceAdapter(RAW_DIR / 'green_space_metrics.json')
    crime_adapter = FixtureCrimeAdapter(RAW_DIR / 'crime_metrics.json')
    population_adapter = FixturePopulationAdapter(RAW_DIR / 'population_metrics.json')
    wellbeing_adapter = FixtureWellbeingAdapter(RAW_DIR / 'wellbeing_metrics.json')
    wellbeing_last_updated = str(
        wellbeing_adapter.source.get('releaseDate') or config.last_updated_default,
    )

    transport_anchor_records = (
        json.loads(TRANSPORT_METRICS_PATH.read_text(encoding='utf-8'))
        if TRANSPORT_METRICS_PATH.exists()
        else {}
    )
    property_anchor_records = json.loads((RAW_DIR / 'property_metrics.json').read_text(encoding='utf-8'))
    school_anchor_records = json.loads((RAW_DIR / 'schools_metrics.json').read_text(encoding='utf-8'))
    pollution_anchor_records = json.loads((RAW_DIR / 'pollution_metrics.json').read_text(encoding='utf-8'))
    green_anchor_records = json.loads((RAW_DIR / 'green_space_metrics.json').read_text(encoding='utf-8'))
    crime_anchor_records = json.loads((RAW_DIR / 'crime_metrics.json').read_text(encoding='utf-8'))
    population_anchor_records = json.loads((RAW_DIR / 'population_metrics.json').read_text(encoding='utf-8'))
    crime_scale = crime_score_bounds(crime_anchor_records)

    raw_stations = station_adapter.fetch_stations()
    all_stations, excluded_stations = sanitize_station_universe(raw_stations)
    stations_by_code = {station.station_code: station for station in all_stations}
    scoped_stations = candidate_filter(all_stations, config, transport_anchor_records)
    deduped_stations = dedupe_micro_areas(scoped_stations, config.station_distance_threshold_m)
    london_wide_all_deduped = dedupe_micro_areas(all_stations, config.station_distance_threshold_m)
    london_wide_candidate_stations = [
        station
        for station in london_wide_all_deduped
        if transport_metric_or_fallback(station, transport_anchor_records, 'typical_commute_min')
        <= LONDON_WIDE_MAX_COMMUTE_MINUTES
    ]
    london_wide_deduped = london_wide_candidate_stations
    london_wide_excluded_by_commute = [
        {
            'stationCode': station.station_code,
            'stationName': station.station_name,
            'typicalCommuteMinutes': transport_metric_or_fallback(
                station,
                transport_anchor_records,
                'typical_commute_min',
            ),
        }
        for station in london_wide_all_deduped
        if transport_metric_or_fallback(station, transport_anchor_records, 'typical_commute_min')
        > LONDON_WIDE_MAX_COMMUTE_MINUTES
    ]

    def build_scope(
        stations_for_scope: list[StationRecord],
        overlap_reference: list[StationRecord],
        *,
        scope_label: str,
    ) -> list[dict[str, Any]]:
        micro_areas: list[dict[str, Any]] = []
        resolved_records_by_station: dict[str, dict[str, dict[str, Any] | None]] = {}

        for station in stations_for_scope:
            transport_record = (
                transport_adapter.get_by_station(station.station_code) if transport_adapter else None
            ) or transport_anchor_records.get(station.station_code) or synthesize_record_from_anchors(
                station,
                stations_by_code,
                transport_anchor_records,
                [
                    'typical_commute_min',
                    'peak_commute_min',
                    'offpeak_commute_min',
                    'peak_tph',
                    'interchange_count',
                    'drive_to_pinner_min',
                ],
                'Estimated by inverse-distance interpolation from nearby station transport metrics.',
            )
            if transport_record is None:
                transport_record = {
                    'typical_commute_min': round(float(station.typical_commute_min), 3),
                    'peak_commute_min': round(float(station.peak_commute_min), 3),
                    'offpeak_commute_min': round(float(station.offpeak_commute_min), 3),
                    'peak_tph': round(float(station.peak_tph), 3),
                    'interchange_count': int(station.interchange_count),
                    'drive_to_pinner_min': round(float(station.drive_to_pinner_min), 3),
                    'status': 'estimated',
                    'confidence': 0.55,
                    'provenance': 'heuristic',
                    'field_statuses': {
                        'typical_commute_min': 'estimated',
                        'peak_commute_min': 'estimated',
                        'offpeak_commute_min': 'estimated',
                        'peak_tph': 'estimated',
                        'interchange_count': 'estimated',
                        'drive_to_pinner_min': 'estimated',
                    },
                    'field_confidences': {
                        'typical_commute_min': 0.55,
                        'peak_commute_min': 0.55,
                        'offpeak_commute_min': 0.55,
                        'peak_tph': 0.5,
                        'interchange_count': 0.5,
                        'drive_to_pinner_min': 0.55,
                    },
                    'field_provenance': {
                        'typical_commute_min': 'heuristic',
                        'peak_commute_min': 'heuristic',
                        'offpeak_commute_min': 'heuristic',
                        'peak_tph': 'heuristic',
                        'interchange_count': 'heuristic',
                        'drive_to_pinner_min': 'heuristic',
                    },
                    'methodology_note': (
                        'Fallback transport heuristic from station profile because no direct '
                        'transport source or reliable nearby-anchor transport estimates were available.'
                    ),
                }

            property_record = property_adapter.get_by_station(
                station.station_code,
            ) or synthesize_record_from_anchors(
                station,
                stations_by_code,
                property_anchor_records,
                [
                    'average_semi_price',
                    'median_semi_price',
                    'price_trend_pct_5y',
                    'price_score',
                ],
                'Estimated by inverse-distance interpolation from nearby station asking-price metrics where direct current listing samples are unavailable.',
            )
            school_record = school_adapter.get_by_station(station.station_code) or synthesize_record_from_anchors(
                station,
                stations_by_code,
                school_anchor_records,
                [
                    'nearby_primary_count',
                    'primary_quality_score',
                    'primary_attendance_score',
                    'primary_ofsted_penalty',
                    'primary_ofsted_warning_share',
                ],
                'Estimated by inverse-distance interpolation from nearby station primary-school composites built from state-funded-only schools using an admissions-aware reachability heuristic. Private schools are excluded and Ofsted remains an overlay rather than the main score driver.',
            )
            pollution_record = pollution_adapter.get_by_station(
                station.station_code,
            ) or synthesize_record_from_anchors(
                station,
                stations_by_code,
                pollution_anchor_records,
                ['annual_no2', 'annual_pm25'],
                'Estimated by inverse-distance interpolation from nearby station pollution proxies.',
            )
            green_record = green_adapter.get_by_station(station.station_code) or synthesize_record_from_anchors(
                station,
                stations_by_code,
                green_anchor_records,
                ['green_space_area_km2_within_1km', 'green_cover_pct', 'nearest_park_distance_m'],
                'Estimated by inverse-distance interpolation from nearby station greenspace proxies.',
            )
            crime_record = crime_adapter.get_by_station(station.station_code) or synthesize_record_from_anchors(
                station,
                stations_by_code,
                crime_anchor_records,
                ['crime_rate_per_1000'],
                'Estimated by inverse-distance interpolation from nearby station crime-rate proxies.',
            )
            if crime_record and 'breakdown' not in crime_record:
                rate = float(crime_record.get('crime_rate_per_1000', 0.0))
                crime_record['breakdown'] = synthesize_crime_breakdown(
                    rate,
                    station,
                    stations_by_code,
                    crime_anchor_records,
                )

            population_record = population_adapter.get_by_station(
                station.station_code,
            ) or synthesize_record_from_anchors(
                station,
                stations_by_code,
                population_anchor_records,
                ['population_in_reference_zone'],
                'Estimated by inverse-distance interpolation from nearby station denominator proxies.',
            )
            wellbeing_record = wellbeing_adapter.get_by_local_authority(station.local_authority)

            resolved_records_by_station[station.station_code] = {
                'transport': transport_record,
                'property': property_record,
                'school': school_record,
                'pollution': pollution_record,
                'green': green_record,
                'crime': crime_record,
                'population': population_record,
                'wellbeing': wellbeing_record,
            }

        for station in stations_for_scope:
            station_records = resolved_records_by_station.get(station.station_code, {})
            transport_record = station_records.get('transport')
            property_record = station_records.get('property')
            school_record = station_records.get('school')
            pollution_record = station_records.get('pollution')
            green_record = station_records.get('green')
            crime_record = station_records.get('crime')
            population_record = station_records.get('population')
            wellbeing_record = station_records.get('wellbeing')

            components = score_components(
                station,
                transport_record,
                property_record,
                school_record,
                population_record,
                pollution_record,
                green_record,
                crime_record,
                crime_scale_bounds=crime_scale,
            )

            overlap_conf = overlap_confidence(
                station,
                overlap_reference,
                config.micro_area_walk_radius_m,
            )

            metrics = {
                'averageSemiDetachedPrice': metric_from_record(
                    property_record,
                    'average_semi_price',
                    unit='GBP',
                    note='Average asking price for semi-detached homes with 3+ bedrooms and 2+ bathrooms where current listing coverage is available; otherwise sold-price fallback.',
                    last_updated=property_last_updated,
                ),
                'medianSemiDetachedPrice': metric_from_record(
                    property_record,
                    'median_semi_price',
                    unit='GBP',
                    note='Median asking price for semi-detached homes with 3+ bedrooms and 2+ bathrooms where current listing coverage is available; otherwise latest sold-price fallback.',
                    last_updated=property_last_updated,
                ),
                'semiPriceTrendPct5y': metric_from_record(
                    property_record,
                    'price_trend_pct_5y',
                    unit='%',
                    note='Approximate 5-year trend in sold price levels.',
                    last_updated=property_last_updated,
                ),
                'priceScore': metric_from_record(
                    property_record,
                    'price_score',
                    unit='score',
                    note='Simple inverse price score based only on the local median semi-detached price: lower prices score higher and higher prices score lower.',
                    last_updated=property_last_updated,
                ),
                'commuteTypicalMinutes': metric_from_record(
                    transport_record,
                    'typical_commute_min',
                    unit='minutes',
                    note='Typical journey time to configured central destination.',
                    last_updated=transport_last_updated,
                    fallback_value=float(station.typical_commute_min),
                    fallback_status='estimated',
                    fallback_confidence=0.55,
                    fallback_provenance='heuristic',
                ),
                'commutePeakMinutes': metric_from_record(
                    transport_record,
                    'peak_commute_min',
                    unit='minutes',
                    note='Peak journey time estimate to configured central destination.',
                    last_updated=transport_last_updated,
                    fallback_value=float(station.peak_commute_min),
                    fallback_status='estimated',
                    fallback_confidence=0.55,
                    fallback_provenance='heuristic',
                ),
                'commuteOffPeakMinutes': metric_from_record(
                    transport_record,
                    'offpeak_commute_min',
                    unit='minutes',
                    note='Off-peak journey time estimate to configured central destination.',
                    last_updated=transport_last_updated,
                    fallback_value=float(station.offpeak_commute_min),
                    fallback_status='estimated',
                    fallback_confidence=0.55,
                    fallback_provenance='heuristic',
                ),
                'serviceFrequencyPeakTph': metric_from_record(
                    transport_record,
                    'peak_tph',
                    unit='tph',
                    note='Peak service frequency estimate.',
                    last_updated=transport_last_updated,
                    fallback_value=float(station.peak_tph),
                    fallback_status='estimated',
                    fallback_confidence=0.5,
                    fallback_provenance='heuristic',
                ),
                'interchangeCount': metric_from_record(
                    transport_record,
                    'interchange_count',
                    unit='count',
                    note='Interchange count to configured central destination.',
                    last_updated=transport_last_updated,
                    fallback_value=float(station.interchange_count),
                    fallback_status='estimated',
                    fallback_confidence=0.5,
                    fallback_provenance='heuristic',
                ),
                'driveTimeToPinnerMinutes': metric_from_record(
                    transport_record,
                    'drive_to_pinner_min',
                    unit='minutes',
                    note='Drive-time estimate from station centroid to Pinner reference point.',
                    last_updated=transport_last_updated,
                    fallback_value=float(station.drive_to_pinner_min),
                    fallback_status='estimated',
                    fallback_confidence=0.55,
                    fallback_provenance='heuristic',
                ),
                'nearbyPrimaryCount': metric_from_record(
                    school_record,
                    'nearby_primary_count',
                    unit='count',
                    note='Admissions-adjusted equivalent count of state-funded primary schools that look realistically reachable from the area anchor after distance, faith-designation, and capacity weighting; private schools excluded.',
                    last_updated=schools_last_updated,
                ),
                'nearbySecondaryCount': metric_from_record(
                    school_record,
                    'nearby_secondary_count',
                    unit='count',
                    note='Secondary phase is intentionally excluded from the current school ranking model.',
                    last_updated=schools_last_updated,
                ),
                'primaryQualityScore': metric_from_record(
                    school_record,
                    'primary_quality_score',
                    unit='score',
                    note='Primary school attainment basket from the latest eligible 2023-onward official KS2 results across realistically reachable state-funded schools (combined expected standard, combined higher standard, reading scaled score, maths scaled score).',
                    last_updated=schools_last_updated,
                ),
                'secondaryQualityScore': metric_from_record(
                    school_record,
                    'secondary_quality_score',
                    unit='score',
                    note='Secondary phase is intentionally excluded from the current school ranking model.',
                    last_updated=schools_last_updated,
                ),
                'annualNo2': metric_from_record(
                    pollution_record,
                    'annual_no2',
                    unit='ug/m3',
                    note='Annual NO2 mean from the DEFRA PCM modelled background pollution grid.',
                    last_updated=pollution_last_updated,
                ),
                'annualPm25': metric_from_record(
                    pollution_record,
                    'annual_pm25',
                    unit='ug/m3',
                    note='Annual PM2.5 mean from the DEFRA PCM modelled background pollution grid.',
                    last_updated=pollution_last_updated,
                ),
                'greenSpaceAreaKm2Within1km': metric_from_record(
                    green_record,
                    'green_space_area_km2_within_1km',
                    unit='km2',
                    note='Estimated publicly accessible green space within 1km.',
                    last_updated=green_last_updated,
                ),
                'greenCoverPct': metric_from_record(
                    green_record,
                    'green_cover_pct',
                    unit='%',
                    note='Direct green-cover fraction measured within a double-radius station greenspace catchment.',
                    last_updated=green_last_updated,
                ),
                'nearestParkDistanceM': metric_from_record(
                    green_record,
                    'nearest_park_distance_m',
                    unit='m',
                    note='Distance to nearest substantial park entry point.',
                    last_updated=green_last_updated,
                ),
                'crimeRatePerThousand': metric_from_record(
                    crime_record,
                    'crime_rate_per_1000',
                    unit='per_1000',
                    note='Annualised station-area crime rate per 1,000 residents using all currently available data.police.uk monthly street-level archive snapshots from 2023 onward and the local denominator.',
                    last_updated=crime_last_updated,
                ),
                'boroughQolScore': metric_from_record(
                    wellbeing_record,
                    'qol_score_0_100',
                    unit='score',
                    note=(
                        'Borough-level QoL composite from ONS APS personal well-being means '
                        '(life satisfaction, worthwhile, happiness, and inverted anxiety).'
                    ),
                    last_updated=wellbeing_last_updated,
                    fallback_value=None,
                    fallback_status='missing',
                    fallback_confidence=0.25,
                    fallback_provenance='missing',
                ),
            }

            confidence = confidence_score(list(metrics.values()), overlap_conf)
            overall = weighted_score(components, config.default_weights, confidence)

            flags: list[str] = []
            if scope_label == 'londonWide':
                flags.append(
                    'Included in the broader London coverage view for this dataset refresh.',
                )
            primary_ofsted_warning_share = (
                float(school_record.get('primary_ofsted_warning_share'))
                if school_record and isinstance(school_record.get('primary_ofsted_warning_share'), (int, float))
                else None
            )
            if primary_ofsted_warning_share is not None and primary_ofsted_warning_share >= 18:
                flags.append(
                    'Primary-school overlay warning: a meaningful share of the realistically reachable primary-school pool carries current Ofsted caution signals.'
                )

            for metric_name, metric_value in metrics.items():
                if metric_value.status != 'available':
                    flags.append(f'{metric_name} status is {metric_value.status}.')
                if metric_value.value is None:
                    flags.append(f'{metric_name} value is missing.')

            confidence_notes = [
                'Scores are catchment-level proxies and should be validated with on-the-ground checks.',
                'School scoring is now primary-only and blends an admissions-aware access heuristic, the latest eligible 2023-onward KS2 attainment basket, a light attendance supplement, and an Ofsted warning overlay rather than a single inspection label.',
                'Green-cover percentage uses an expanded 2x walk-radius neighborhood blend.',
            ]

            micro_area = {
                'microAreaId': f"ma-{station.station_code.lower()}",
                'stationCode': station.station_code,
                'stationName': station.station_name,
                'operator': station.operator,
                'lines': station.lines,
                'localAuthority': station.local_authority,
                'countyOrBorough': station.county_or_borough,
                'centroid': asdict(station.coordinate),
                'catchment': {
                    'type': 'circle',
                    'radiusMeters': config.micro_area_walk_radius_m,
                },
                'overlapConfidence': overlap_conf,
                'dataConfidenceScore': confidence,
                'confidenceNotes': confidence_notes,
                'flags': sorted(set(flags)),
                'walkCatchmentAssumption': f"{config.micro_area_walk_radius_m}m walk radius around station centroid",
                'commuteDestination': config.destination_station,
                'schoolMethodologyNotes': str(
                    (school_record or {}).get(
                        'methodology_note',
                        'Composite score from multiple indicators with explicit confidence weighting.',
                    ),
                ),
                'boroughQolAuthority': str(
                    (wellbeing_record or {}).get('ons_geography_name', station.local_authority),
                ),
                'boroughQolPeriod': str(
                    (wellbeing_record or {}).get('period', ''),
                ),
                'boroughQolMethodology': str(
                    (wellbeing_record or {}).get(
                        'methodology_note',
                        'No ONS personal well-being match found for this local authority.',
                    ),
                ),
                'crimeCategoryBreakdown': (crime_record or {}).get('breakdown', {}),
                'populationDenominator': (population_record or {}).get('population_in_reference_zone'),
                'componentScores': components,
                'overallWeightedScore': overall,
                'rankingExplanationRules': ranking_rules(components),
                **{name: metric_value.to_dict() for name, metric_value in metrics.items()},
            }

            micro_areas.append(micro_area)

        micro_areas.sort(key=lambda item: item['overallWeightedScore'], reverse=True)
        return micro_areas

    micro_areas = build_scope(deduped_stations, deduped_stations, scope_label='default')
    london_wide_micro_areas = build_scope(
        london_wide_deduped,
        london_wide_deduped,
        scope_label='londonWide',
    )

    generated_at = datetime.now(ZoneInfo(config.generated_timezone)).isoformat(timespec='seconds')

    return {
        'generatedAt': generated_at,
        'methodologyVersion': config.methodology_version,
        'destinationStation': config.destination_station,
        'config': {
            'pinnerCoordinate': asdict(config.pinner_coordinate),
            'centralLondonCoordinate': asdict(config.central_london_coordinate),
            'stationSearchRadiusKm': config.station_search_radius_km,
            'primaryScopeRegion': 'Commute-defined commuter belt',
            'microAreaWalkRadiusM': config.micro_area_walk_radius_m,
            'greenCoverExpandedRadiusM': int(
                config.micro_area_walk_radius_m * GREEN_COVER_EXPANDED_RADIUS_MULTIPLIER,
            ),
            'greenCoverExpandedRadiusMultiplier': GREEN_COVER_EXPANDED_RADIUS_MULTIPLIER,
            'maxCommuteMinutesForCandidate': config.max_commute_minutes,
            'maxDriveMinutesForCandidate': config.max_drive_minutes_to_pinner,
            'defaultUsesPinnerRadiusPrefilter': False,
            'defaultUsesDriveToPinnerPrefilter': False,
            'londonWideMaxCommuteMinutesForCandidate': LONDON_WIDE_MAX_COMMUTE_MINUTES,
            'londonWideUsesPinnerRadiusPrefilter': False,
            'londonWideUsesDriveToPinnerPrefilter': False,
            'londonWideSourceStationCount': len(london_wide_all_deduped),
            'londonWideExcludedByCommuteCount': len(london_wide_excluded_by_commute),
            'defaultWeights': config.default_weights,
            'boroughQolSource': wellbeing_adapter.source,
            'sourceMetadata': source_metadata,
            'stationUniverse': {
                'rawStationCount': len(raw_stations),
                'keptStationCount': len(all_stations),
                'excludedStationCount': len(excluded_stations),
                'excludedSample': excluded_stations[:50],
            },
        },
        'microAreas': micro_areas,
        'londonWideMicroAreas': london_wide_micro_areas,
        'londonWideExcludedByCommute': london_wide_excluded_by_commute,
    }


def write_outputs(dataset: dict[str, Any]) -> None:
    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)

    (PROCESSED_DIR / 'micro_areas.json').write_text(
        json.dumps(dataset, indent=2, ensure_ascii=True),
        encoding='utf-8',
    )

    summary = {
        'generatedAt': dataset['generatedAt'],
        'count': len(dataset['microAreas']),
        'londonWideCount': len(dataset.get('londonWideMicroAreas', [])),
        'topMicroAreas': [
            {
                'microAreaId': area['microAreaId'],
                'stationName': area['stationName'],
                'score': area['overallWeightedScore'],
            }
            for area in dataset['microAreas'][:10]
        ],
        'topLondonWideMicroAreas': [
            {
                'microAreaId': area['microAreaId'],
                'stationName': area['stationName'],
                'score': area['overallWeightedScore'],
            }
            for area in dataset.get('londonWideMicroAreas', [])[:10]
        ],
    }

    (PROCESSED_DIR / 'summary.json').write_text(
        json.dumps(summary, indent=2, ensure_ascii=True),
        encoding='utf-8',
    )


def main() -> None:
    config = load_config(CONFIG_PATH)
    dataset = compile_micro_areas(config)

    pollution_records = json.loads((RAW_DIR / 'pollution_metrics.json').read_text(encoding='utf-8'))
    quality_report = generate_quality_report(dataset, pollution_records, weights=config.default_weights)

    live_verification = os.getenv('RUN_SOURCE_VERIFICATION', '0') == '1'
    verification_report = generate_verification_report(dataset, live_mode=live_verification)
    dataset['verificationSummary'] = {
        'overallStatus': verification_report['overallStatus'],
        'sourceCoverageScore': verification_report.get('sourceCoverageScore'),
        'verificationStrengthScore': verification_report.get('verificationStrengthScore'),
        'verificationCompletenessScore': verification_report.get('sourceCoverageScore'),
        'crimeCrossCheckStatus': verification_report['crossChecks']['crime']['status'],
        'dataQualityStatus': quality_report['overallStatus'],
        'qualityCriticalIssues': quality_report['counts']['critical'],
        'qualityWarningIssues': quality_report['counts']['warning'],
        'liveMode': live_verification,
        'generatedAt': verification_report['generatedAt'],
    }
    write_outputs(dataset)
    write_report(verification_report, PROCESSED_DIR / 'verification_report.json')
    write_quality_report(quality_report, PROCESSED_DIR / 'data_quality_report.json')

    if quality_report['counts']['critical'] > 0:
        raise RuntimeError(
            f"Dataset quality checks failed with {quality_report['counts']['critical']} critical issues. "
            f"See {PROCESSED_DIR / 'data_quality_report.json'}.",
        )

    print(
        f"Generated {len(dataset['microAreas'])} default micro-areas and "
        f"{len(dataset.get('londonWideMicroAreas', []))} coverage-view micro-areas -> "
        f"{PROCESSED_DIR / 'micro_areas.json'}",
    )


if __name__ == '__main__':
    main()
