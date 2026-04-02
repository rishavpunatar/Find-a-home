import type { ComponentScores, DerivedMicroArea, MicroArea, Weights } from '@/types/domain'

import { rankingAxes, rankingAxisKeys } from './rankingAxes'
import { normalizeWeights } from './weights'

const clampScore = (value: number): number => Math.max(0, Math.min(100, value))

export const computeWeightedScore = (
  componentScores: ComponentScores,
  weights: Weights,
  confidenceScore: number,
): number => {
  const normalized = normalizeWeights(weights)
  const weighted = rankingAxisKeys.reduce(
    (sum, key) => sum + clampScore(componentScores[key]) * normalized[key],
    0,
  )

  const confidenceFactor = 0.5 + Math.max(0, Math.min(1, confidenceScore)) * 0.5

  return Number(((weighted / 100) * confidenceFactor).toFixed(2))
}

export const rankMicroAreas = (areas: MicroArea[], weights: Weights): DerivedMicroArea[] => {
  const sorted = [...areas]
    .map((area) => ({
      ...area,
      dynamicOverallScore: computeWeightedScore(
        area.componentScores,
        weights,
        area.dataConfidenceScore,
      ),
    }))
    .sort((a, b) => b.dynamicOverallScore - a.dynamicOverallScore)

  return sorted.map((area, index) => ({
    ...area,
    overallRank: index + 1,
  }))
}

export const buildRankingExplanation = (area: MicroArea): string[] => {
  const scorePairs: Array<{ key: keyof Weights; value: number; label: string }> = rankingAxes.map(
    (axis) => ({
      key: axis.key,
      value: area.componentScores[axis.key],
      label: axis.rankingExplanationLabel,
    }),
  )

  const sorted = [...scorePairs].sort((a, b) => b.value - a.value)
  const strengths = sorted.slice(0, 2)
  const weaknesses = sorted.slice(-2)

  return [
    `Strength: ${strengths[0]?.label} (${strengths[0]?.value.toFixed(1)}) supports this rank.`,
    `Strength: ${strengths[1]?.label} (${strengths[1]?.value.toFixed(1)}) also performs well.`,
    `Drag factor: ${weaknesses[0]?.label} (${weaknesses[0]?.value.toFixed(1)}) reduces rank.`,
    `Drag factor: ${weaknesses[1]?.label} (${weaknesses[1]?.value.toFixed(1)}) is below peer areas.`,
  ]
}
