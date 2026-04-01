import { describe, expect, it } from 'vitest'

import {
  interquartileRange,
  median,
  medianAbsoluteDeviation,
  quantile,
  summarizeDistribution,
} from './statistics'

describe('summarizeDistribution', () => {
  it('returns null for empty input', () => {
    expect(summarizeDistribution([])).toBeNull()
  })

  it('calculates basic distribution statistics', () => {
    const summary = summarizeDistribution([10, 12, 14, 16])

    expect(summary).not.toBeNull()
    expect(summary?.count).toBe(4)
    expect(summary?.mean).toBe(13)
    expect(summary?.variance).toBe(5)
    expect(summary?.standardDeviation).toBeCloseTo(Math.sqrt(5), 6)
    expect(summary?.min).toBe(10)
    expect(summary?.max).toBe(16)
    expect(summary?.bins.reduce((sum, bin) => sum + bin.count, 0)).toBe(4)
  })

  it('collapses identical values into a single bin', () => {
    const summary = summarizeDistribution([7, 7, 7])

    expect(summary?.bins).toEqual([{ start: 7, end: 7, count: 3 }])
  })

  it('computes robust quantiles and spread measures', () => {
    const values = [10, 12, 14, 16, 100]

    expect(quantile(values, 0.25)).toBe(12)
    expect(median(values)).toBe(14)
    expect(interquartileRange(values)).toBe(4)
    expect(medianAbsoluteDeviation(values)).toBe(2)
  })
})
