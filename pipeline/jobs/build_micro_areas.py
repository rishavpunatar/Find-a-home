from __future__ import annotations

import json
import math
import os
from dataclasses import asdict
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from pipeline.adapters.crime_adapter import FixtureCrimeAdapter
from pipeline.adapters.green_space_adapter import FixtureGreenSpaceAdapter
from pipeline.adapters.planning_adapter import FixturePlanningAdapter
from pipeline.adapters.pollution_adapter import FixturePollutionAdapter
from pipeline.adapters.population_adapter import FixturePopulationAdapter
from pipeline.adapters.property_adapter import FixturePropertyAdapter
from pipeline.adapters.school_adapter import FixtureSchoolAdapter
from pipeline.adapters.station_transport_adapter import FixtureStationTransportAdapter
from pipeline.jobs.validate_dataset import generate_quality_report, write_quality_report
from pipeline.jobs.verify_data_sources import generate_verification_report, write_report
from pipeline.models.entities import Coordinate, NumericMetric, SearchConfig, StationRecord
from pipeline.models.scoring import clamp, forward_score, inverse_score, mean, weighted_score


ROOT = Path(__file__).resolve().parents[2]
RAW_DIR = ROOT / 'data' / 'raw'
PROCESSED_DIR = ROOT / 'data' / 'processed'
CONFIG_PATH = ROOT / 'pipeline' / 'config' / 'search_config.json'
LONDON_WIDE_MAX_COMMUTE_MINUTES = 60
GREEN_COVER_EXPANDED_RADIUS_MULTIPLIER = 2.0


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
    note: str,
    last_updated: str,
) -> NumericMetric:
    return NumericMetric(
        value=None if value is None else float(value),
        unit=unit,
        status=status,
        confidence=confidence,
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
) -> NumericMetric:
    if record is None or record.get(key) is None:
        return metric(
            fallback_value,
            unit,
            fallback_status,
            fallback_confidence,
            note,
            last_updated,
        )

    return metric(
        record.get(key),
        unit,
        str(record.get('status', 'estimated')),
        float(record.get('confidence', fallback_confidence)),
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

    synthesized: dict[str, Any] = {}
    for key in value_keys:
        value = idw_interpolate_value(samples, key)
        if value is None:
            return None
        synthesized[key] = round(float(value), 3)

    synthesized['status'] = 'estimated'
    synthesized['confidence'] = interpolated_confidence(samples)
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


def widen_green_cover_pct(
    target: StationRecord,
    stations_for_scope: list[StationRecord],
    green_records_by_station: dict[str, dict[str, Any] | None],
    walk_catchment_radius_m: int,
) -> dict[str, Any] | None:
    base_record = green_records_by_station.get(target.station_code)
    if not base_record:
        return None

    expanded_radius_m = walk_catchment_radius_m * GREEN_COVER_EXPANDED_RADIUS_MULTIPLIER
    weighted_cover_sum = 0.0
    weighted_confidence_sum = 0.0
    weight_total = 0.0
    sample_count = 0

    for neighbour in stations_for_scope:
        neighbour_record = green_records_by_station.get(neighbour.station_code)
        if not neighbour_record:
            continue

        neighbour_cover = neighbour_record.get('green_cover_pct')
        if neighbour_cover is None:
            continue

        distance_m = haversine_distance_m(target.coordinate, neighbour.coordinate)
        if distance_m > expanded_radius_m:
            continue

        weight = 1.0 / (max(distance_m, 80.0) ** 1.2)
        weighted_cover_sum += float(neighbour_cover) * weight
        weighted_confidence_sum += float(neighbour_record.get('confidence', 0.6)) * weight
        weight_total += weight
        sample_count += 1

    if weight_total == 0:
        return base_record

    wider_cover = weighted_cover_sum / weight_total
    wider_confidence = weighted_confidence_sum / weight_total
    confidence = clamp(
        wider_confidence * (0.9 + 0.08 * min(1.0, sample_count / 6.0)),
        0.25,
        0.9,
    )

    status = str(base_record.get('status', 'estimated')) if sample_count <= 1 else 'estimated'
    catchment_multiplier = int(GREEN_COVER_EXPANDED_RADIUS_MULTIPLIER)

    return {
        **base_record,
        'green_cover_pct': round(float(wider_cover), 3),
        'status': status,
        'confidence': round(float(confidence), 3),
        'methodology_note': (
            'Green-cover percentage uses a wider neighbourhood proxy: distance-weighted mean of '
            f'nearby station green-cover values within {int(expanded_radius_m)}m '
            f'({catchment_multiplier}x the walk catchment radius).'
        ),
    }


def candidate_filter(stations: list[StationRecord], config: SearchConfig) -> list[StationRecord]:
    pinner = config.pinner_coordinate
    within_belt = [
        station
        for station in stations
        if haversine_distance_m(station.coordinate, pinner) <= config.station_search_radius_km * 1000
    ]

    return [
        station
        for station in within_belt
        if station.typical_commute_min <= config.max_commute_minutes
        and station.drive_to_pinner_min <= config.max_drive_minutes_to_pinner
    ]


def dedupe_micro_areas(stations: list[StationRecord], threshold_m: float) -> list[StationRecord]:
    priority_sorted = sorted(
        stations,
        key=lambda station: (
            station.typical_commute_min + station.drive_to_pinner_min - station.peak_tph * 0.6,
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


def score_components(
    station: StationRecord,
    price: dict[str, Any] | None,
    schools: dict[str, Any] | None,
    pollution: dict[str, Any] | None,
    green: dict[str, Any] | None,
    crime: dict[str, Any] | None,
    planning: dict[str, Any] | None,
) -> dict[str, float]:
    affordability = float(price.get('affordability_score', 45)) if price else 45
    value_for_money = float(price.get('value_for_money_score', 45)) if price else 45
    value_score = mean([affordability, value_for_money])

    commute_score = inverse_score(station.typical_commute_min, best=20, worst=60)
    peak_score = inverse_score(station.peak_commute_min, best=22, worst=70)
    frequency_score = forward_score(station.peak_tph, min_value=4, max_value=18)
    interchange_score = inverse_score(station.interchange_count, best=0, worst=3)
    transport_score = mean([
        commute_score * 0.45,
        peak_score * 0.2,
        frequency_score * 0.2,
        interchange_score * 0.15,
    ]) * (1 / 0.25)

    primary_quality = float(schools.get('primary_quality_score', 50)) if schools else 50
    secondary_quality = float(schools.get('secondary_quality_score', 50)) if schools else 50
    primary_count = float(schools.get('nearby_primary_count', 0)) if schools else 0
    secondary_count = float(schools.get('nearby_secondary_count', 0)) if schools else 0
    school_count_score = mean(
        [forward_score(primary_count, min_value=1, max_value=18), forward_score(secondary_count, 1, 8)],
    )
    school_quality_score = mean([primary_quality, secondary_quality])
    schools_score = school_quality_score * 0.72 + school_count_score * 0.28

    no2 = float(pollution.get('annual_no2', 30)) if pollution else 30
    pm25 = float(pollution.get('annual_pm25', 14)) if pollution else 14
    green_cover = float(green.get('green_cover_pct', 20)) if green else 20
    green_area = float(green.get('green_space_area_km2_within_1km', 0.8)) if green else 0.8
    park_distance = float(green.get('nearest_park_distance_m', 900)) if green else 900
    environment_score = (
        inverse_score(pm25, 7, 18) * 0.34
        + inverse_score(no2, 10, 40) * 0.16
        + forward_score(green_cover, 10, 62) * 0.2
        + forward_score(green_area, 0.3, 3.2) * 0.18
        + inverse_score(park_distance, 120, 1500) * 0.12
    )

    crime_rate = float(crime.get('crime_rate_per_1000', 95)) if crime else 95
    crime_score = inverse_score(crime_rate, best=25, worst=130)

    proximity_score = inverse_score(station.drive_to_pinner_min, best=2, worst=30)

    planning_risk = float(planning.get('planning_risk_score', 55)) if planning else 55
    planning_score = inverse_score(planning_risk, best=15, worst=80)

    return {
        'value': round(clamp(value_score), 1),
        'transport': round(clamp(transport_score), 1),
        'schools': round(clamp(schools_score), 1),
        'environment': round(clamp(environment_score), 1),
        'crime': round(clamp(crime_score), 1),
        'proximity': round(clamp(proximity_score), 1),
        'planningRisk': round(clamp(planning_score), 1),
    }


def confidence_score(metrics: list[NumericMetric], overlap_conf: float) -> float:
    return round(clamp(mean([metric_item.confidence for metric_item in metrics] + [overlap_conf]), 0.0, 1.0), 3)


def ranking_rules(component_scores: dict[str, float]) -> list[str]:
    labels = {
        'value': 'value-for-money',
        'transport': 'transport',
        'schools': 'school quality and access',
        'environment': 'air quality and green space',
        'crime': 'safety',
        'proximity': 'proximity to Pinner',
        'planningRisk': 'planning risk exposure',
    }

    sorted_pairs = sorted(component_scores.items(), key=lambda item: item[1], reverse=True)
    strengths = sorted_pairs[:2]
    weaknesses = sorted_pairs[-2:]

    return [
        f"Strong {labels[strengths[0][0]]} score ({strengths[0][1]:.1f}) improves rank.",
        f"Strong {labels[strengths[1][0]]} score ({strengths[1][1]:.1f}) supports rank stability.",
        f"Lower {labels[weaknesses[0][0]]} score ({weaknesses[0][1]:.1f}) drags the overall rank.",
        f"Lower {labels[weaknesses[1][0]]} score ({weaknesses[1][1]:.1f}) limits upside.",
    ]


def compile_micro_areas(config: SearchConfig) -> dict[str, Any]:
    station_adapter = FixtureStationTransportAdapter(RAW_DIR / 'stations_transport.json')
    property_adapter = FixturePropertyAdapter(RAW_DIR / 'property_metrics.json')
    school_adapter = FixtureSchoolAdapter(RAW_DIR / 'schools_metrics.json')
    pollution_adapter = FixturePollutionAdapter(RAW_DIR / 'pollution_metrics.json')
    green_adapter = FixtureGreenSpaceAdapter(RAW_DIR / 'green_space_metrics.json')
    crime_adapter = FixtureCrimeAdapter(RAW_DIR / 'crime_metrics.json')
    population_adapter = FixturePopulationAdapter(RAW_DIR / 'population_metrics.json')
    planning_adapter = FixturePlanningAdapter(RAW_DIR / 'planning_metrics.json')

    property_anchor_records = json.loads((RAW_DIR / 'property_metrics.json').read_text(encoding='utf-8'))
    school_anchor_records = json.loads((RAW_DIR / 'schools_metrics.json').read_text(encoding='utf-8'))
    pollution_anchor_records = json.loads((RAW_DIR / 'pollution_metrics.json').read_text(encoding='utf-8'))
    green_anchor_records = json.loads((RAW_DIR / 'green_space_metrics.json').read_text(encoding='utf-8'))
    crime_anchor_records = json.loads((RAW_DIR / 'crime_metrics.json').read_text(encoding='utf-8'))
    population_anchor_records = json.loads((RAW_DIR / 'population_metrics.json').read_text(encoding='utf-8'))
    planning_anchor_records = json.loads((RAW_DIR / 'planning_metrics.json').read_text(encoding='utf-8'))

    all_stations = station_adapter.fetch_stations()
    stations_by_code = {station.station_code: station for station in all_stations}
    scoped_stations = candidate_filter(all_stations, config)
    deduped_stations = dedupe_micro_areas(scoped_stations, config.station_distance_threshold_m)
    london_wide_all_deduped = dedupe_micro_areas(all_stations, config.station_distance_threshold_m)
    london_wide_deduped = [
        station
        for station in london_wide_all_deduped
        if station.typical_commute_min <= LONDON_WIDE_MAX_COMMUTE_MINUTES
    ]
    london_wide_excluded_by_commute = [
        {
            'stationCode': station.station_code,
            'stationName': station.station_name,
            'typicalCommuteMinutes': station.typical_commute_min,
        }
        for station in london_wide_all_deduped
        if station.typical_commute_min > LONDON_WIDE_MAX_COMMUTE_MINUTES
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
                    'affordability_score',
                    'value_for_money_score',
                ],
                'Estimated by inverse-distance interpolation from nearby fixture-backed station property metrics.',
            )
            school_record = school_adapter.get_by_station(station.station_code) or synthesize_record_from_anchors(
                station,
                stations_by_code,
                school_anchor_records,
                [
                    'nearby_primary_count',
                    'nearby_secondary_count',
                    'primary_quality_score',
                    'secondary_quality_score',
                ],
                'Estimated by inverse-distance interpolation from nearby station school composites. No single inspection label is used.',
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
            planning_record = planning_adapter.get_by_station(station.station_code)
            if not planning_record or planning_record.get('planning_risk_score') is None:
                planning_record = synthesize_record_from_anchors(
                    station,
                    stations_by_code,
                    planning_anchor_records,
                    ['planning_risk_score'],
                    'Heuristic planning/development risk estimated by interpolation from nearby placeholder station scores.',
                ) or planning_record

            resolved_records_by_station[station.station_code] = {
                'property': property_record,
                'school': school_record,
                'pollution': pollution_record,
                'green': green_record,
                'crime': crime_record,
                'population': population_record,
                'planning': planning_record,
            }

        base_green_records = {
            station_code: records['green']
            for station_code, records in resolved_records_by_station.items()
        }
        widened_green_records = {
            station.station_code: widen_green_cover_pct(
                station,
                stations_for_scope,
                base_green_records,
                config.micro_area_walk_radius_m,
            )
            for station in stations_for_scope
        }

        for station in stations_for_scope:
            station_records = resolved_records_by_station.get(station.station_code, {})
            property_record = station_records.get('property')
            school_record = station_records.get('school')
            pollution_record = station_records.get('pollution')
            green_record = widened_green_records.get(station.station_code) or station_records.get('green')
            crime_record = station_records.get('crime')
            population_record = station_records.get('population')
            planning_record = station_records.get('planning')

            components = score_components(
                station,
                property_record,
                school_record,
                pollution_record,
                green_record,
                crime_record,
                planning_record,
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
                    note='Derived from semi-detached transactions around station catchment.',
                    last_updated=config.last_updated_default,
                ),
                'medianSemiDetachedPrice': metric_from_record(
                    property_record,
                    'median_semi_price',
                    unit='GBP',
                    note='Median semi-detached sold price from fixture-backed transaction sample.',
                    last_updated=config.last_updated_default,
                ),
                'semiPriceTrendPct5y': metric_from_record(
                    property_record,
                    'price_trend_pct_5y',
                    unit='%',
                    note='Approximate 5-year trend in sold price levels.',
                    last_updated=config.last_updated_default,
                ),
                'affordabilityScore': metric_from_record(
                    property_record,
                    'affordability_score',
                    unit='score',
                    note='Affordability proxy from local median prices and commuting context.',
                    last_updated=config.last_updated_default,
                ),
                'valueForMoneyScore': metric_from_record(
                    property_record,
                    'value_for_money_score',
                    unit='score',
                    note='Composite balancing median semi prices against commute and schools.',
                    last_updated=config.last_updated_default,
                ),
                'commuteTypicalMinutes': metric(
                    station.typical_commute_min,
                    'minutes',
                    'estimated',
                    0.8,
                    'Typical journey time to configured central destination from timetable profile.',
                    config.last_updated_default,
                ),
                'commutePeakMinutes': metric(
                    station.peak_commute_min,
                    'minutes',
                    'estimated',
                    0.8,
                    'Peak journey time approximation from station profile.',
                    config.last_updated_default,
                ),
                'commuteOffPeakMinutes': metric(
                    station.offpeak_commute_min,
                    'minutes',
                    'estimated',
                    0.8,
                    'Off-peak journey time approximation from station profile.',
                    config.last_updated_default,
                ),
                'serviceFrequencyPeakTph': metric(
                    station.peak_tph,
                    'tph',
                    'estimated',
                    0.75,
                    'Peak frequency estimate from fixture timetable profile.',
                    config.last_updated_default,
                ),
                'interchangeCount': metric(
                    float(station.interchange_count),
                    'count',
                    'estimated',
                    0.72,
                    'Interchange count to central destination from route pattern heuristics.',
                    config.last_updated_default,
                ),
                'driveTimeToPinnerMinutes': metric(
                    station.drive_to_pinner_min,
                    'minutes',
                    'estimated',
                    0.75,
                    'Drive-time estimate from station centroid to Pinner reference point.',
                    config.last_updated_default,
                ),
                'nearbyPrimaryCount': metric_from_record(
                    school_record,
                    'nearby_primary_count',
                    unit='count',
                    note='Nearby primary schools in and around 1km catchment proxy.',
                    last_updated=config.last_updated_default,
                ),
                'nearbySecondaryCount': metric_from_record(
                    school_record,
                    'nearby_secondary_count',
                    unit='count',
                    note='Nearby secondary schools in and around 1.5km proxy zone.',
                    last_updated=config.last_updated_default,
                ),
                'primaryQualityScore': metric_from_record(
                    school_record,
                    'primary_quality_score',
                    unit='score',
                    note='Primary school quality composite.',
                    last_updated=config.last_updated_default,
                ),
                'secondaryQualityScore': metric_from_record(
                    school_record,
                    'secondary_quality_score',
                    unit='score',
                    note='Secondary school quality composite.',
                    last_updated=config.last_updated_default,
                ),
                'annualNo2': metric_from_record(
                    pollution_record,
                    'annual_no2',
                    unit='ug/m3',
                    note='Annual NO2 mean from area-level pollution proxy grid.',
                    last_updated=config.last_updated_default,
                ),
                'annualPm25': metric_from_record(
                    pollution_record,
                    'annual_pm25',
                    unit='ug/m3',
                    note='Annual PM2.5 mean from area-level pollution proxy grid.',
                    last_updated=config.last_updated_default,
                ),
                'greenSpaceAreaKm2Within1km': metric_from_record(
                    green_record,
                    'green_space_area_km2_within_1km',
                    unit='km2',
                    note='Estimated publicly accessible green space within 1km.',
                    last_updated=config.last_updated_default,
                ),
                'greenCoverPct': metric_from_record(
                    green_record,
                    'green_cover_pct',
                    unit='%',
                    note='Estimated green cover fraction using a wider (2x) catchment neighborhood proxy.',
                    last_updated=config.last_updated_default,
                ),
                'nearestParkDistanceM': metric_from_record(
                    green_record,
                    'nearest_park_distance_m',
                    unit='m',
                    note='Distance to nearest substantial park entry point.',
                    last_updated=config.last_updated_default,
                ),
                'crimeRatePerThousand': metric_from_record(
                    crime_record,
                    'crime_rate_per_1000',
                    unit='per_1000',
                    note='Annualised crime incidents per 1,000 residents proxy.',
                    last_updated=config.last_updated_default,
                ),
                'planningRiskHeuristic': metric_from_record(
                    planning_record,
                    'planning_risk_score',
                    unit='score',
                    note='Low-confidence planning/development pressure heuristic.',
                    last_updated=config.last_updated_default,
                    fallback_value=55,
                    fallback_status='placeholder',
                    fallback_confidence=0.2,
                ),
            }

            confidence = confidence_score(list(metrics.values()), overlap_conf)
            overall = weighted_score(components, config.default_weights, confidence)

            flags: list[str] = []
            if metrics['planningRiskHeuristic'].confidence < 0.5:
                flags.append('Planning risk uses a low-confidence heuristic placeholder.')
            if scope_label == 'londonWide':
                flags.append(
                    'Included in London-wide scope generated from all known stations (no Pinner-radius prefilter).',
                )

            for metric_name, metric_value in metrics.items():
                if metric_value.status != 'available':
                    flags.append(f'{metric_name} status is {metric_value.status}.')
                if metric_value.value is None:
                    flags.append(f'{metric_name} value is missing.')

            confidence_notes = [
                'Scores are catchment-level proxies and should be validated with on-the-ground checks.',
                'School scoring uses composite indicators and does not rely on a single inspection field.',
                'Green-cover percentage uses an expanded 2x walk-radius neighborhood blend.',
                'Planning/development risk is explicitly low-confidence until structured feeds are integrated.',
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
                'planningRiskMethodology': str(
                    (planning_record or {}).get(
                        'methodology_note',
                        'No planning feed linked. Placeholder score only.',
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
            'microAreaWalkRadiusM': config.micro_area_walk_radius_m,
            'greenCoverExpandedRadiusM': int(
                config.micro_area_walk_radius_m * GREEN_COVER_EXPANDED_RADIUS_MULTIPLIER,
            ),
            'greenCoverExpandedRadiusMultiplier': GREEN_COVER_EXPANDED_RADIUS_MULTIPLIER,
            'maxCommuteMinutesForCandidate': config.max_commute_minutes,
            'maxDriveMinutesForCandidate': config.max_drive_minutes_to_pinner,
            'londonWideMaxCommuteMinutesForCandidate': LONDON_WIDE_MAX_COMMUTE_MINUTES,
            'londonWideUsesPinnerRadiusPrefilter': False,
            'londonWideUsesDriveToPinnerPrefilter': False,
            'londonWideSourceStationCount': len(london_wide_all_deduped),
            'londonWideExcludedByCommuteCount': len(london_wide_excluded_by_commute),
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
        f"{len(dataset.get('londonWideMicroAreas', []))} London-wide micro-areas -> "
        f"{PROCESSED_DIR / 'micro_areas.json'}",
    )


if __name__ == '__main__':
    main()
