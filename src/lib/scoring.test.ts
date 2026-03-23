import { describe, expect, it } from 'vitest'

import type { ComponentScores } from '@/types/domain'

import { DEFAULT_WEIGHTS } from './constants'
import { computeWeightedScore } from './scoring'

const componentScores: ComponentScores = {
  value: 80,
  transport: 70,
  schools: 90,
  environment: 60,
  crime: 75,
  proximity: 85,
  planningRisk: 40,
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
    const resultB = computeWeightedScore(
      {
        ...componentScores,
      },
      {
        value: 50,
        transport: 40,
        schools: 40,
        environment: 30,
        crime: 25,
        proximity: 10,
        planningRisk: 5,
      },
      0.9,
    )

    expect(resultA).toBeCloseTo(resultB, 2)
  })

  it('changes score when weight distribution changes', () => {
    const defaultResult = computeWeightedScore(componentScores, DEFAULT_WEIGHTS, 0.9)
    const skewedResult = computeWeightedScore(
      componentScores,
      {
        value: 5,
        transport: 5,
        schools: 55,
        environment: 20,
        crime: 10,
        proximity: 3,
        planningRisk: 2,
      },
      0.9,
    )

    expect(defaultResult).not.toBe(skewedResult)
  })
})
