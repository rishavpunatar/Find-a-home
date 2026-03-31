import type { DerivedMicroArea, MetricStatus, MicroArea } from '@/types/domain'

import { HIGH_CONFIDENCE_MIN_CONFIDENCE_PCT } from './constants'

export type DomainKey =
  | 'property'
  | 'transport'
  | 'schools'
  | 'pollution'
  | 'greenSpace'
  | 'crime'
  | 'planning'
  | 'wellbeing'

export type TrustTier = 'high' | 'medium' | 'low'

export interface DomainStatusCounts {
  available: number
  estimated: number
  placeholder: number
  missing: number
}

const statusPriority: Record<MetricStatus, number> = {
  available: 0,
  estimated: 1,
  placeholder: 2,
  missing: 3,
}

const mergeStatuses = (statuses: MetricStatus[]): MetricStatus =>
  [...statuses].sort((left, right) => statusPriority[right] - statusPriority[left])[0] ?? 'missing'

export const getAreaDomainStatuses = (
  area: MicroArea,
): Record<DomainKey, MetricStatus> => ({
  property: area.medianSemiDetachedPrice.status,
  transport: area.commuteTypicalMinutes.status,
  schools: mergeStatuses([area.primaryQualityScore.status, area.secondaryQualityScore.status]),
  pollution: area.annualPm25.status,
  greenSpace: area.greenCoverPct.status,
  crime: area.crimeRatePerThousand.status,
  planning: area.planningRiskHeuristic.status,
  wellbeing: area.boroughQolScore.status,
})

export const countStatuses = (statuses: MetricStatus[]): DomainStatusCounts =>
  statuses.reduce<DomainStatusCounts>(
    (counts, status) => ({
      ...counts,
      [status]: counts[status] + 1,
    }),
    {
      available: 0,
      estimated: 0,
      placeholder: 0,
      missing: 0,
    },
  )

export const getAreaDomainStatusCounts = (area: MicroArea): DomainStatusCounts =>
  countStatuses(Object.values(getAreaDomainStatuses(area)))

export const getAreaTrustTier = (area: MicroArea): TrustTier => {
  const confidencePct = area.dataConfidenceScore * 100

  if (confidencePct >= HIGH_CONFIDENCE_MIN_CONFIDENCE_PCT) {
    return 'high'
  }

  if (confidencePct >= 55) {
    return 'medium'
  }

  return 'low'
}

export const isHighConfidenceArea = (area: MicroArea): boolean =>
  getAreaTrustTier(area) === 'high'

export const summarizeDatasetDomainCoverage = (areas: DerivedMicroArea[] | MicroArea[]) => {
  const totals = {
    property: countStatuses(areas.map((area) => getAreaDomainStatuses(area).property)),
    transport: countStatuses(areas.map((area) => getAreaDomainStatuses(area).transport)),
    schools: countStatuses(areas.map((area) => getAreaDomainStatuses(area).schools)),
    pollution: countStatuses(areas.map((area) => getAreaDomainStatuses(area).pollution)),
    greenSpace: countStatuses(areas.map((area) => getAreaDomainStatuses(area).greenSpace)),
    crime: countStatuses(areas.map((area) => getAreaDomainStatuses(area).crime)),
    planning: countStatuses(areas.map((area) => getAreaDomainStatuses(area).planning)),
    wellbeing: countStatuses(areas.map((area) => getAreaDomainStatuses(area).wellbeing)),
  }

  return Object.entries(totals).map(([key, counts]) => ({
    key: key as DomainKey,
    counts,
    availablePct:
      areas.length === 0 ? 0 : Number(((counts.available / areas.length) * 100).toFixed(1)),
  }))
}
