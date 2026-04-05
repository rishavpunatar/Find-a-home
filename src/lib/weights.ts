import type { MicroArea, Weights } from '@/types/domain'

import { DEFAULT_WEIGHTS } from './constants'
import { rankingAxisKeys } from './rankingAxes'
import { interquartileRange, median, medianAbsoluteDeviation } from './statistics'

export const weightKeys = rankingAxisKeys

const roundTo = (value: number, decimals = 2): number => {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

export const normalizeWeights = (weights: Weights): Weights => {
  const total = weightKeys.reduce((sum, key) => sum + Math.max(weights[key], 0), 0)

  if (total <= 0) {
    return { ...DEFAULT_WEIGHTS }
  }

  return weightKeys.reduce((acc, key) => {
    acc[key] = roundTo((Math.max(weights[key], 0) / total) * 100)
    return acc
  }, {} as Weights)
}

export const weightsSum = (weights: Weights): number =>
  weightKeys.reduce((sum, key) => sum + weights[key], 0)

export const clampWeight = (value: number): number =>
  Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0

const clampFactor = (value: number, minimum: number, maximum: number): number =>
  Math.max(minimum, Math.min(maximum, value))

const isSourceAppliedProvenance = (value?: string): boolean =>
  value === 'direct' || value === 'direct_blend' || value?.startsWith('direct_') === true

const scoreMetricValues = (
  areas: MicroArea[],
  key: keyof Weights,
): number[] => areas.map((area) => area.componentScores[key]).filter((value) => Number.isFinite(value))

const componentMetricGroups = {
  transport: (area: MicroArea) => [
    area.commuteTypicalMinutes,
    area.commutePeakMinutes,
    area.commuteOffPeakMinutes,
    area.serviceFrequencyPeakTph,
    area.interchangeCount,
  ],
  schools: (area: MicroArea) => [
    area.nearbyPrimaryCount,
    area.primaryQualityScore,
  ],
  environment: (area: MicroArea) => [
    area.annualPm25,
    area.greenCoverPct,
    area.greenSpaceAreaKm2Within1km,
    area.nearestParkDistanceM,
  ],
  crime: (area: MicroArea) => [area.crimeRatePerThousand],
  roads: (area: MicroArea) => [
    area.nearestMainRoadDistanceM,
    area.majorRoadLengthKmWithin1600m,
  ],
} satisfies Record<keyof Weights, (area: MicroArea) => Array<{ confidence: number; provenance?: string }>>

const computeQualityFactor = (areas: MicroArea[], key: keyof Weights): number => {
  const metrics = areas.flatMap(componentMetricGroups[key])
  if (metrics.length === 0) {
    return 0.9
  }

  const averageConfidence =
    metrics.reduce((sum, metric) => sum + Math.max(0, Math.min(1, metric.confidence ?? 0)), 0) /
    metrics.length
  const sourceRatio =
    metrics.filter((metric) => isSourceAppliedProvenance(metric.provenance)).length / metrics.length
  const compositeQuality = averageConfidence * 0.7 + sourceRatio * 0.3

  return clampFactor(0.85 + compositeQuality * 0.15, 0.85, 1)
}

export const buildVarianceAwareDefaultWeights = (areas: MicroArea[]): Weights => {
  if (areas.length === 0) {
    return { ...DEFAULT_WEIGHTS }
  }

  const spreads = weightKeys.map((key) => {
    const values = scoreMetricValues(areas, key)
    const iqr = interquartileRange(values) ?? 0
    const mad = medianAbsoluteDeviation(values) ?? 0
    const robustSpread = Math.max(iqr, mad * 1.4826, 0.1)
    return {
      key,
      robustSpread,
      qualityFactor: computeQualityFactor(areas, key),
    }
  })

  const spreadCenter = median(spreads.map((entry) => entry.robustSpread)) ?? 1

  const adjustedWeights = spreads.reduce(
    (acc, entry) => {
      if (DEFAULT_WEIGHTS[entry.key] <= 0) {
        acc[entry.key] = 0
        return acc
      }

      const spreadFactor = clampFactor(entry.robustSpread / spreadCenter, 0.8, 1.2)
      acc[entry.key] = DEFAULT_WEIGHTS[entry.key] * spreadFactor * entry.qualityFactor
      return acc
    },
    {} as Weights,
  )

  return normalizeWeights(adjustedWeights)
}
