import type { DerivedMicroArea } from '@/types/domain'

const csvEscape = (value: string | number): string => {
  const serialized = `${value}`

  if (serialized.includes(',') || serialized.includes('"') || serialized.includes('\n')) {
    return `"${serialized.replaceAll('"', '""')}"`
  }

  return serialized
}

export const shortlistToCsv = (areas: DerivedMicroArea[]): string => {
  const header = [
    'micro_area_id',
    'station_name',
    'overall_rank',
    'overall_score',
    'median_semi_price_gbp',
    'commute_minutes',
    'drive_to_pinner_minutes',
    'school_score',
    'road_score',
    'nearest_main_road_distance_m',
    'borough_qol_score',
    'environment_score',
    'crime_score',
  ]

  const rows = areas.map((area) => [
    area.microAreaId,
    area.stationName,
    area.overallRank,
    area.dynamicOverallScore.toFixed(2),
    area.medianSemiDetachedPrice.value ?? 'N/A',
    area.commuteTypicalMinutes.value ?? 'N/A',
    area.driveTimeToPinnerMinutes.value ?? 'N/A',
    area.componentScores.schools.toFixed(1),
    area.componentScores.roads.toFixed(1),
    area.nearestMainRoadDistanceM.value ?? 'N/A',
    area.boroughQolScore.value ?? 'N/A',
    area.componentScores.environment.toFixed(1),
    area.componentScores.crime.toFixed(1),
  ])

  return [header, ...rows].map((row) => row.map(csvEscape).join(',')).join('\n')
}
