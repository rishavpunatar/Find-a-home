import { describe, expect, it } from 'vitest'

import {
  schoolAccessPerPopulation,
  schoolAccessSubscore,
  totalSchoolAccessPerPopulation,
} from './schoolAccess'

describe('schoolAccess helpers', () => {
  it('converts school counts into population-adjusted access rates', () => {
    expect(totalSchoolAccessPerPopulation(120, 30, 10_000)).toBe(150)
    expect(schoolAccessPerPopulation(120, 10_000)).toBe(120)
    expect(schoolAccessPerPopulation(30, 10_000)).toBe(30)
  })

  it('falls back to a reference population when population is missing', () => {
    expect(totalSchoolAccessPerPopulation(120, 30, null)).not.toBeNull()
    expect(schoolAccessPerPopulation(120, undefined)).not.toBeNull()
  })

  it('builds a stronger subscore for better population-adjusted access', () => {
    const better = schoolAccessSubscore(140, 38, 10_000)
    const worse = schoolAccessSubscore(50, 12, 10_000)

    expect(better).toBeGreaterThan(worse)
  })

  it('still returns a deterministic score when population is missing', () => {
    const result = schoolAccessSubscore(18, 8, null)
    expect(result).toBeGreaterThanOrEqual(0)
    expect(result).toBeLessThanOrEqual(100)
  })
})
