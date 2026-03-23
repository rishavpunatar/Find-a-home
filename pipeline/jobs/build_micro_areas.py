from __future__ import annotations

import json
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
from pipeline.models.entities import Coordinate, NumericMetric, SearchConfig, StationRecord
from pipeline.models.scoring import clamp, forward_score, inverse_score, mean, weighted_score


ROOT = Path(__file__).resolve().parents[2]
RAW_DIR = ROOT / 'data' / 'raw'
PROCESSED_DIR = ROOT / 'data' / 'processed'
CONFIG_PATH = ROOT / 'pipeline' / 'config' / 'search_config.json'


def load_config(path: Path) -> SearchConfig:
    payload = json.loads(path.read_text(encoding='utf-8'))
    return SearchConfig(
        methodology_version=payload['methodology_version'],
        generated_timezone=payload['generated_timezone'],
        pinner_coordinate=Coordinate(
            lat=payload['pinner_coordinate']['lat'],
            lon=payload['pinner_coordinate']['lon'],
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
        inverse_score(no2, 10, 40) * 0.28
        + inverse_score(pm25, 7, 18) * 0.22
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

    all_stations = station_adapter.fetch_stations()
    scoped_stations = candidate_filter(all_stations, config)
    deduped_stations = dedupe_micro_areas(scoped_stations, config.station_distance_threshold_m)

    micro_areas: list[dict[str, Any]] = []

    for station in deduped_stations:
        property_record = property_adapter.get_by_station(station.station_code)
        school_record = school_adapter.get_by_station(station.station_code)
        pollution_record = pollution_adapter.get_by_station(station.station_code)
        green_record = green_adapter.get_by_station(station.station_code)
        crime_record = crime_adapter.get_by_station(station.station_code)
        population_record = population_adapter.get_by_station(station.station_code)
        planning_record = planning_adapter.get_by_station(station.station_code)

        components = score_components(
            station,
            property_record,
            school_record,
            pollution_record,
            green_record,
            crime_record,
            planning_record,
        )

        overlap_conf = overlap_confidence(station, deduped_stations, config.micro_area_walk_radius_m)

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
                note='Estimated green cover fraction from land-cover proxy.',
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

        for metric_name, metric_value in metrics.items():
            if metric_value.status != 'available':
                flags.append(f'{metric_name} status is {metric_value.status}.')
            if metric_value.value is None:
                flags.append(f'{metric_name} value is missing.')

        confidence_notes = [
            'Scores are catchment-level proxies and should be validated with on-the-ground checks.',
            'School scoring uses composite indicators and does not rely on a single inspection field.',
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

    generated_at = datetime.now(ZoneInfo(config.generated_timezone)).isoformat(timespec='seconds')

    return {
        'generatedAt': generated_at,
        'methodologyVersion': config.methodology_version,
        'destinationStation': config.destination_station,
        'config': {
            'pinnerCoordinate': asdict(config.pinner_coordinate),
            'stationSearchRadiusKm': config.station_search_radius_km,
            'microAreaWalkRadiusM': config.micro_area_walk_radius_m,
            'maxCommuteMinutesForCandidate': config.max_commute_minutes,
            'maxDriveMinutesForCandidate': config.max_drive_minutes_to_pinner,
        },
        'microAreas': micro_areas,
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
        'topMicroAreas': [
            {
                'microAreaId': area['microAreaId'],
                'stationName': area['stationName'],
                'score': area['overallWeightedScore'],
            }
            for area in dataset['microAreas'][:10]
        ],
    }

    (PROCESSED_DIR / 'summary.json').write_text(
        json.dumps(summary, indent=2, ensure_ascii=True),
        encoding='utf-8',
    )


def main() -> None:
    config = load_config(CONFIG_PATH)
    dataset = compile_micro_areas(config)
    write_outputs(dataset)
    print(f"Generated {len(dataset['microAreas'])} micro-areas -> {PROCESSED_DIR / 'micro_areas.json'}")


if __name__ == '__main__':
    main()
