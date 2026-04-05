import { describe, expect, it } from 'vitest'

import type { ComponentScores } from '@/types/domain'

import { DEFAULT_WEIGHTS } from './constants'
import { computeWeightedScore } from './scoring'

const componentScores: ComponentScores = {
  transport: 70,
  schools: 90,
  environment: 60,
  crime: 75,
  roads: 55,
}

describe('computeWeightedScore', () => {
  it('computes weighted score with confidence adjustment', () => {
    const highConfidence = computeWeightedScore(componentScores, DEFAULT_WEIGHTS, 1)
    const lowConfidence = computeWeightedScore(componentScores, DEFAULT_WEIGHTS, 0.4)

    expect(highConfidence).toBeGreaterThan(lowConfidence)
    expect(highConfidence).toBeGreaterThan(0)
    expect(highConfidence).toBeLessThanOrEqual(100)
  })

  it('normalizes equivalent scaled weights to same score', () => {
    const resultA = computeWeightedScore(componentScores, DEFAULT_WEIGHTS, 0.9)
    const scaledWeights = {
      transport: DEFAULT_WEIGHTS.transport * 2,
      schools: DEFAULT_WEIGHTS.schools * 2,
      environment: DEFAULT_WEIGHTS.environment * 2,
      crime: DEFAULT_WEIGHTS.crime * 2,
      roads: DEFAULT_WEIGHTS.roads * 2,
    }
    const resultB = computeWeightedScore(
      componentScores,
      scaledWeights,
      0.9,
    )

    expect(resultA).toBeCloseTo(resultB, 2)
  })

  it('changes score when weight distribution changes', () => {
    const defaultResult = computeWeightedScore(componentScores, DEFAULT_WEIGHTS, 0.9)
    const skewedResult = computeWeightedScore(
      componentScores,
      {
        transport: 5,
        schools: 60,
        environment: 20,
        crime: 15,
        roads: 0,
      },
      0.9,
    )

    expect(defaultResult).not.toBe(skewedResult)
  })
})
