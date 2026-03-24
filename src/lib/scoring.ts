import type { ComponentScores, DerivedMicroArea, MicroArea, Weights } from '@/types/domain'

import { normalizeWeights } from './weights'

const scoreKeys = [
  'value',
  'transport',
  'schools',
  'environment',
  'crime',
  'proximity',
  'planningRisk',
] satisfies (keyof ComponentScores)[]

const clampScore = (value: number): number => Math.max(0, Math.min(100, value))

export const computeWeightedScore = (
  componentScores: ComponentScores,
  weights: Weights,
  confidenceScore: number,
): number => {
  const normalized = normalizeWeights(weights)
  const weighted = scoreKeys.reduce(
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
  const scorePairs: Array<{ key: keyof ComponentScores; value: number; label: string }> = [
    { key: 'value', value: area.componentScores.value, label: 'value for money' },
    { key: 'transport', value: area.componentScores.transport, label: 'transport' },
    { key: 'schools', value: area.componentScores.schools, label: 'schools' },
    { key: 'environment', value: area.componentScores.environment, label: 'environment' },
    { key: 'crime', value: area.componentScores.crime, label: 'safety' },
    { key: 'proximity', value: area.componentScores.proximity, label: 'proximity to Pinner' },
    { key: 'planningRisk', value: area.componentScores.planningRisk, label: 'planning risk' },
  ]

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
