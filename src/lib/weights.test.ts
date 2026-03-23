import { describe, expect, it } from 'vitest'

import { DEFAULT_WEIGHTS } from './constants'
import { clampWeight, normalizeWeights, weightsSum } from './weights'

describe('weights helpers', () => {
  it('normalizes arbitrary weights to 100', () => {
    const normalized = normalizeWeights({
      value: 10,
      transport: 10,
      schools: 10,
      environment: 10,
      crime: 10,
      proximity: 10,
      planningRisk: 10,
    })

    expect(weightsSum(normalized)).toBeCloseTo(100, 0)
    expect(normalized.value).toBeCloseTo(14.29, 2)
  })

  it('falls back to defaults when total is non-positive', () => {
    const normalized = normalizeWeights({
      value: 0,
      transport: 0,
      schools: 0,
      environment: 0,
      crime: 0,
      proximity: 0,
      planningRisk: 0,
    })

    expect(normalized).toEqual(DEFAULT_WEIGHTS)
  })

  it('clamps weight values', () => {
    expect(clampWeight(-10)).toBe(0)
    expect(clampWeight(55)).toBe(55)
    expect(clampWeight(150)).toBe(100)
  })
})
