import { describe, expect, it } from 'vitest'

import type { MicroArea } from '@/types/domain'

import { DEFAULT_WEIGHTS } from './constants'
import { buildVarianceAwareDefaultWeights, clampWeight, normalizeWeights, weightsSum } from './weights'

describe('weights helpers', () => {
  it('normalizes arbitrary weights to 100', () => {
    const normalized = normalizeWeights({
      transport: 10,
      schools: 10,
      environment: 10,
      crime: 10,
    })

    expect(weightsSum(normalized)).toBeCloseTo(100, 0)
    expect(normalized.transport).toBeCloseTo(25, 2)
  })

  it('falls back to defaults when total is non-positive', () => {
    const normalized = normalizeWeights({
      transport: 0,
      schools: 0,
      environment: 0,
      crime: 0,
    })

    expect(normalized).toEqual(DEFAULT_WEIGHTS)
  })

  it('clamps weight values', () => {
    expect(clampWeight(-10)).toBe(0)
    expect(clampWeight(55)).toBe(55)
    expect(clampWeight(150)).toBe(100)
  })

  it('builds variance-aware defaults with bounded adjustments', () => {
    const makeMetric = (value: number, confidence = 0.9, provenance = 'direct') => ({
      value,
      unit: 'score',
      status: 'available' as const,
      confidence,
      provenance,
      methodologyNote: 'Test',
      lastUpdated: '2026-04-01',
    })

    const makeArea = (
      id: string,
      overrides: Partial<MicroArea['componentScores']>,
    ): MicroArea => ({
      microAreaId: id,
      stationCode: id,
      stationName: id,
      operator: 'Test',
      lines: ['Test'],
      localAuthority: 'Test',
      countyOrBorough: 'Greater London',
      centroid: { lat: 0, lon: 0 },
      catchment: { type: 'circle', radiusMeters: 800 },
      overlapConfidence: 0.8,
      dataConfidenceScore: 0.8,
      confidenceNotes: [],
      flags: [],
      averageSemiDetachedPrice: makeMetric(600000),
      medianSemiDetachedPrice: makeMetric(590000),
      semiPriceTrendPct5y: makeMetric(12),
      walkCatchmentAssumption: '800m walk radius',
      commuteDestination: 'Central London core',
      commuteTypicalMinutes: makeMetric(40),
      commutePeakMinutes: makeMetric(45),
      commuteOffPeakMinutes: makeMetric(35),
      serviceFrequencyPeakTph: makeMetric(8),
      interchangeCount: makeMetric(1),
      driveTimeToPinnerMinutes: makeMetric(25),
      nearbyPrimaryCount: makeMetric(8),
      nearbySecondaryCount: makeMetric(4),
      primaryQualityScore: makeMetric(70),
      secondaryQualityScore: makeMetric(72),
      schoolMethodologyNotes: 'Test',
      annualNo2: makeMetric(18),
      annualPm25: makeMetric(10),
      greenSpaceAreaKm2Within1km: makeMetric(1.1),
      greenCoverPct: makeMetric(30),
      nearestParkDistanceM: makeMetric(300),
      crimeRatePerThousand: makeMetric(40),
      crimeCategoryBreakdown: {},
      boroughQolScore: makeMetric(74),
      boroughQolAuthority: 'Test',
      boroughQolPeriod: '2022-23',
      boroughQolMethodology: 'Test',
      componentScores: {
        transport: 60,
        schools: 60,
        environment: 60,
        crime: 60,
        ...overrides,
      },
      overallWeightedScore: 60,
      rankingExplanationRules: [],
    })

    const weights = buildVarianceAwareDefaultWeights([
      makeArea('a', { transport: 25, schools: 60, environment: 62, crime: 55 }),
      makeArea('b', { transport: 55, schools: 61, environment: 63, crime: 56 }),
      makeArea('c', { transport: 85, schools: 62, environment: 64, crime: 57 }),
      makeArea('d', { transport: 45, schools: 63, environment: 65, crime: 58 }),
    ])

    expect(weightsSum(weights)).toBeCloseTo(100, 0)
    expect(weights.transport).toBeGreaterThan(weights.environment)
    expect(weights.schools).toBeGreaterThan(0)
  })
})
