import type { DerivedMicroArea, MetricStatus, MicroArea, NumericMetric } from '@/types/domain'

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

export interface DomainSourceCounts {
  sourceApplied: number
  modelled: number
  missing: number
}

export type SourceBucket = keyof DomainSourceCounts

const statusPriority: Record<MetricStatus, number> = {
  available: 0,
  estimated: 1,
  placeholder: 2,
  missing: 3,
}

const sourcePriority: Record<SourceBucket, number> = {
  sourceApplied: 0,
  modelled: 1,
  missing: 2,
}

const mergeStatuses = (statuses: MetricStatus[]): MetricStatus =>
  [...statuses].sort((left, right) => statusPriority[right] - statusPriority[left])[0] ?? 'missing'

const mergeSourceBuckets = (buckets: SourceBucket[]): SourceBucket =>
  [...buckets].sort((left, right) => sourcePriority[right] - sourcePriority[left])[0] ?? 'missing'

export const isSourceAppliedProvenance = (value?: string): boolean =>
  value === 'direct' || value === 'direct_blend' || value?.startsWith('direct_') === true

export const getSourceBucket = (value?: string): SourceBucket => {
  if (!value || value === 'missing') {
    return 'missing'
  }

  return isSourceAppliedProvenance(value) ? 'sourceApplied' : 'modelled'
}

export const describeMetricEvidence = (provenance?: string): string => {
  switch (provenance) {
    case 'direct_listing':
      return 'Current listings'
    case 'direct_transactions':
      return 'Recent sold-price fallback'
    case 'direct_blend':
      return 'Blended direct source'
    case 'direct':
      return 'Direct source'
    case 'interpolated':
      return 'Interpolated estimate'
    case 'heuristic':
      return 'Heuristic estimate'
    default:
      return 'Source unavailable'
  }
}

export const getMetricEvidenceLabel = (metric: NumericMetric): string =>
  describeMetricEvidence(metric.provenance)

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

export const getAreaDomainSourceBuckets = (
  area: MicroArea,
): Record<DomainKey, SourceBucket> => ({
  property: getSourceBucket(area.medianSemiDetachedPrice.provenance),
  transport: mergeSourceBuckets([
    getSourceBucket(area.commuteTypicalMinutes.provenance),
    getSourceBucket(area.driveTimeToPinnerMinutes.provenance),
  ]),
  schools: mergeSourceBuckets([
    getSourceBucket(area.nearbyPrimaryCount.provenance),
    getSourceBucket(area.nearbySecondaryCount.provenance),
    getSourceBucket(area.primaryQualityScore.provenance),
    getSourceBucket(area.secondaryQualityScore.provenance),
  ]),
  pollution: mergeSourceBuckets([
    getSourceBucket(area.annualNo2.provenance),
    getSourceBucket(area.annualPm25.provenance),
  ]),
  greenSpace: mergeSourceBuckets([
    getSourceBucket(area.greenSpaceAreaKm2Within1km.provenance),
    getSourceBucket(area.greenCoverPct.provenance),
    getSourceBucket(area.nearestParkDistanceM.provenance),
  ]),
  crime: getSourceBucket(area.crimeRatePerThousand.provenance),
  planning: getSourceBucket(area.planningRiskHeuristic.provenance),
  wellbeing: getSourceBucket(area.boroughQolScore.provenance),
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

export const countSourceBuckets = (buckets: SourceBucket[]): DomainSourceCounts =>
  buckets.reduce<DomainSourceCounts>(
    (counts, bucket) => ({
      ...counts,
      [bucket]: counts[bucket] + 1,
    }),
    {
      sourceApplied: 0,
      modelled: 0,
      missing: 0,
    },
  )

export const getAreaDomainStatusCounts = (area: MicroArea): DomainStatusCounts =>
  countStatuses(Object.values(getAreaDomainStatuses(area)))

export const getAreaDomainSourceCounts = (area: MicroArea): DomainSourceCounts =>
  countSourceBuckets(Object.values(getAreaDomainSourceBuckets(area)))

export const getAreaPropertyEvidenceLabel = (area: MicroArea): string =>
  describeMetricEvidence(area.medianSemiDetachedPrice.provenance)

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
  const statusTotals = {
    property: countStatuses(areas.map((area) => getAreaDomainStatuses(area).property)),
    transport: countStatuses(areas.map((area) => getAreaDomainStatuses(area).transport)),
    schools: countStatuses(areas.map((area) => getAreaDomainStatuses(area).schools)),
    pollution: countStatuses(areas.map((area) => getAreaDomainStatuses(area).pollution)),
    greenSpace: countStatuses(areas.map((area) => getAreaDomainStatuses(area).greenSpace)),
    crime: countStatuses(areas.map((area) => getAreaDomainStatuses(area).crime)),
    planning: countStatuses(areas.map((area) => getAreaDomainStatuses(area).planning)),
    wellbeing: countStatuses(areas.map((area) => getAreaDomainStatuses(area).wellbeing)),
  }

  const sourceTotals = {
    property: countSourceBuckets(areas.map((area) => getAreaDomainSourceBuckets(area).property)),
    transport: countSourceBuckets(areas.map((area) => getAreaDomainSourceBuckets(area).transport)),
    schools: countSourceBuckets(areas.map((area) => getAreaDomainSourceBuckets(area).schools)),
    pollution: countSourceBuckets(areas.map((area) => getAreaDomainSourceBuckets(area).pollution)),
    greenSpace: countSourceBuckets(areas.map((area) => getAreaDomainSourceBuckets(area).greenSpace)),
    crime: countSourceBuckets(areas.map((area) => getAreaDomainSourceBuckets(area).crime)),
    planning: countSourceBuckets(areas.map((area) => getAreaDomainSourceBuckets(area).planning)),
    wellbeing: countSourceBuckets(areas.map((area) => getAreaDomainSourceBuckets(area).wellbeing)),
  }

  return Object.keys(statusTotals).map((key) => {
    const domainKey = key as DomainKey
    const counts = statusTotals[domainKey]
    const sourceCounts = sourceTotals[domainKey]
    return {
      key: domainKey,
      counts,
      sourceCounts,
      availablePct:
        areas.length === 0 ? 0 : Number(((counts.available / areas.length) * 100).toFixed(1)),
      sourceAppliedPct:
        areas.length === 0
          ? 0
          : Number(((sourceCounts.sourceApplied / areas.length) * 100).toFixed(1)),
    }
  })
}
