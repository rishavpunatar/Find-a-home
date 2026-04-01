import { describe, expect, it } from 'vitest'

import type { DerivedMicroArea } from '@/types/domain'

import { DEFAULT_FILTERS } from './constants'
import { matchesFilters } from './filters'

const baseArea: DerivedMicroArea = {
  microAreaId: 'test',
  stationCode: 'TST',
  stationName: 'Test Station',
  operator: 'Test Rail',
  lines: ['Test line'],
  localAuthority: 'Test Borough',
  countyOrBorough: 'London',
  centroid: { lat: 51.5, lon: -0.3 },
  catchment: { type: 'circle', radiusMeters: 800 },
  overlapConfidence: 0.95,
  dataConfidenceScore: 0.85,
  confidenceNotes: [],
  flags: [],
  averageSemiDetachedPrice: {
    value: 600000,
    unit: 'GBP',
    status: 'available',
    confidence: 0.9,
    methodologyNote: 'Test',
    lastUpdated: '2026-03-01',
  },
  medianSemiDetachedPrice: {
    value: 590000,
    unit: 'GBP',
    status: 'available',
    confidence: 0.9,
    methodologyNote: 'Test',
    lastUpdated: '2026-03-01',
  },
  semiPriceTrendPct5y: {
    value: 16,
    unit: '%',
    status: 'available',
    confidence: 0.9,
    methodologyNote: 'Test',
    lastUpdated: '2026-03-01',
  },
  affordabilityScore: {
    value: 66,
    unit: 'score',
    status: 'available',
    confidence: 0.8,
    methodologyNote: 'Test',
    lastUpdated: '2026-03-01',
  },
  valueForMoneyScore: {
    value: 70,
    unit: 'score',
    status: 'available',
    confidence: 0.8,
    methodologyNote: 'Test',
    lastUpdated: '2026-03-01',
  },
  walkCatchmentAssumption: '800m walk radius',
  commuteDestination: 'Oxford Circus',
  commuteTypicalMinutes: {
    value: 44,
    unit: 'minutes',
    status: 'available',
    confidence: 0.9,
    methodologyNote: 'Test',
    lastUpdated: '2026-03-01',
  },
  commutePeakMinutes: {
    value: 48,
    unit: 'minutes',
    status: 'available',
    confidence: 0.9,
    methodologyNote: 'Test',
    lastUpdated: '2026-03-01',
  },
  commuteOffPeakMinutes: {
    value: 41,
    unit: 'minutes',
    status: 'available',
    confidence: 0.9,
    methodologyNote: 'Test',
    lastUpdated: '2026-03-01',
  },
  serviceFrequencyPeakTph: {
    value: 9,
    unit: 'tph',
    status: 'available',
    confidence: 0.8,
    methodologyNote: 'Test',
    lastUpdated: '2026-03-01',
  },
  interchangeCount: {
    value: 1,
    unit: 'count',
    status: 'available',
    confidence: 0.8,
    methodologyNote: 'Test',
    lastUpdated: '2026-03-01',
  },
  driveTimeToPinnerMinutes: {
    value: 14,
    unit: 'minutes',
    status: 'available',
    confidence: 0.9,
    methodologyNote: 'Test',
    lastUpdated: '2026-03-01',
  },
  nearbyPrimaryCount: {
    value: 8,
    unit: 'count',
    status: 'available',
    confidence: 0.8,
    methodologyNote: 'Test',
    lastUpdated: '2026-03-01',
  },
  nearbySecondaryCount: {
    value: 4,
    unit: 'count',
    status: 'available',
    confidence: 0.8,
    methodologyNote: 'Test',
    lastUpdated: '2026-03-01',
  },
  primaryQualityScore: {
    value: 72,
    unit: 'score',
    status: 'available',
    confidence: 0.8,
    methodologyNote: 'Test',
    lastUpdated: '2026-03-01',
  },
  secondaryQualityScore: {
    value: 76,
    unit: 'score',
    status: 'available',
    confidence: 0.8,
    methodologyNote: 'Test',
    lastUpdated: '2026-03-01',
  },
  schoolMethodologyNotes: 'Test',
  annualNo2: {
    value: 19,
    unit: 'ug/m3',
    status: 'available',
    confidence: 0.8,
    methodologyNote: 'Test',
    lastUpdated: '2026-03-01',
  },
  annualPm25: {
    value: 10,
    unit: 'ug/m3',
    status: 'available',
    confidence: 0.8,
    methodologyNote: 'Test',
    lastUpdated: '2026-03-01',
  },
  greenSpaceAreaKm2Within1km: {
    value: 1.5,
    unit: 'km2',
    status: 'available',
    confidence: 0.7,
    methodologyNote: 'Test',
    lastUpdated: '2026-03-01',
  },
  greenCoverPct: {
    value: 32,
    unit: '%',
    status: 'available',
    confidence: 0.7,
    methodologyNote: 'Test',
    lastUpdated: '2026-03-01',
  },
  nearestParkDistanceM: {
    value: 370,
    unit: 'm',
    status: 'available',
    confidence: 0.7,
    methodologyNote: 'Test',
    lastUpdated: '2026-03-01',
  },
  crimeRatePerThousand: {
    value: 60,
    unit: 'per_1000',
    status: 'available',
    confidence: 0.8,
    methodologyNote: 'Test',
    lastUpdated: '2026-03-01',
  },
  planningRiskHeuristic: {
    value: 32,
    unit: 'score',
    status: 'estimated',
    confidence: 0.55,
    methodologyNote: 'Test',
    lastUpdated: '2026-03-01',
  },
  planningRiskMethodology: 'Test',
  boroughQolScore: {
    value: 72.3,
    unit: 'score',
    status: 'available',
    confidence: 0.88,
    methodologyNote: 'Test',
    lastUpdated: '2023-11-28',
  },
  boroughQolAuthority: 'Test Borough',
  boroughQolPeriod: '2022-23',
  boroughQolMethodology: 'Test',
  componentScores: {
    value: 68,
    transport: 74,
    schools: 78,
    environment: 67,
    crime: 70,
    proximity: 80,
    planningRisk: 45,
  },
  overallWeightedScore: 71,
  dynamicOverallScore: 69,
  overallRank: 1,
  rankingExplanationRules: ['Test'],
}

describe('matchesFilters', () => {
  it('returns true when area satisfies defaults', () => {
    expect(matchesFilters(baseArea, DEFAULT_FILTERS)).toBe(true)
  })

  it('returns false when a max threshold is exceeded', () => {
    expect(
      matchesFilters(
        {
          ...baseArea,
          commuteTypicalMinutes: {
            ...baseArea.commuteTypicalMinutes,
            value: 71,
          },
        },
        DEFAULT_FILTERS,
      ),
    ).toBe(false)
  })

  it('returns false when minimum school score is not met', () => {
    expect(
      matchesFilters(
        {
          ...baseArea,
          componentScores: {
            ...baseArea.componentScores,
            schools: 40,
          },
        },
        DEFAULT_FILTERS,
      ),
    ).toBe(false)
  })

  it('can ignore the drive to Pinner filter for London-wide mode', () => {
    expect(
      matchesFilters(
        {
          ...baseArea,
          driveTimeToPinnerMinutes: {
            ...baseArea.driveTimeToPinnerMinutes,
            value: 34,
          },
        },
        {
          ...DEFAULT_FILTERS,
          maxDriveMinutes: 20,
        },
        {
          ignoreMaxDriveMinutes: true,
        },
      ),
    ).toBe(true)
  })

  it('returns false when confidence is below minimum threshold', () => {
    expect(
      matchesFilters(
        {
          ...baseArea,
          dataConfidenceScore: 0.42,
        },
        {
          ...DEFAULT_FILTERS,
          minDataConfidencePct: 60,
        },
      ),
    ).toBe(false)
  })
})
