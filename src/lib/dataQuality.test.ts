import { describe, expect, it } from 'vitest'

import type { DerivedMicroArea } from '@/types/domain'

import {
  describeMetricEvidence,
  getAreaDomainSourceCounts,
  getAreaDomainStatusCounts,
  getAreaDomainStatuses,
  getAreaPropertyEvidenceLabel,
  getAreaTrustTier,
  isHighConfidenceArea,
} from './dataQuality'

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
  dataConfidenceScore: 0.72,
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
    status: 'estimated',
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
    status: 'estimated',
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
    status: 'missing',
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
    status: 'placeholder',
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
    status: 'estimated',
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

describe('dataQuality helpers', () => {
  it('collapses domain statuses conservatively', () => {
    const statuses = getAreaDomainStatuses(baseArea)

    expect(statuses.property).toBe('estimated')
    expect(statuses.schools).toBe('available')
    expect(statuses.greenSpace).toBe('placeholder')
  })

  it('counts domain statuses for summary badges', () => {
    expect(getAreaDomainStatusCounts(baseArea)).toEqual({
      available: 3,
      estimated: 4,
      placeholder: 1,
      missing: 0,
    })
  })

  it('maps confidence scores into trust tiers', () => {
    expect(getAreaTrustTier(baseArea)).toBe('high')
    expect(isHighConfidenceArea(baseArea)).toBe(true)
    expect(
      getAreaTrustTier({
        ...baseArea,
        dataConfidenceScore: 0.58,
      }),
    ).toBe('medium')
    expect(
      getAreaTrustTier({
        ...baseArea,
        dataConfidenceScore: 0.42,
      }),
    ).toBe('low')
  })

  it('summarizes provenance separately from status', () => {
    const area = {
      ...baseArea,
      medianSemiDetachedPrice: {
        ...baseArea.medianSemiDetachedPrice,
        provenance: 'direct_transactions',
      },
      commuteTypicalMinutes: {
        ...baseArea.commuteTypicalMinutes,
        provenance: 'heuristic',
      },
      commutePeakMinutes: {
        ...baseArea.commutePeakMinutes,
        provenance: 'direct',
      },
      commuteOffPeakMinutes: {
        ...baseArea.commuteOffPeakMinutes,
        provenance: 'direct',
      },
      serviceFrequencyPeakTph: {
        ...baseArea.serviceFrequencyPeakTph,
        provenance: 'direct_live_arrivals',
      },
      interchangeCount: {
        ...baseArea.interchangeCount,
        provenance: 'direct',
      },
      nearbyPrimaryCount: {
        ...baseArea.nearbyPrimaryCount,
        provenance: 'direct',
      },
      nearbySecondaryCount: {
        ...baseArea.nearbySecondaryCount,
        provenance: 'direct',
      },
      primaryQualityScore: {
        ...baseArea.primaryQualityScore,
        provenance: 'direct',
      },
      secondaryQualityScore: {
        ...baseArea.secondaryQualityScore,
        provenance: 'interpolated',
      },
      annualNo2: {
        ...baseArea.annualNo2,
        provenance: 'direct',
      },
      annualPm25: {
        ...baseArea.annualPm25,
        provenance: 'direct',
      },
      greenSpaceAreaKm2Within1km: {
        ...baseArea.greenSpaceAreaKm2Within1km,
        provenance: 'direct',
      },
      greenCoverPct: {
        ...baseArea.greenCoverPct,
        provenance: 'direct_blend',
      },
      nearestParkDistanceM: {
        ...baseArea.nearestParkDistanceM,
        provenance: 'direct',
      },
      crimeRatePerThousand: {
        ...baseArea.crimeRatePerThousand,
        provenance: 'direct',
      },
      planningRiskHeuristic: {
        ...baseArea.planningRiskHeuristic,
        provenance: 'direct',
      },
      boroughQolScore: {
        ...baseArea.boroughQolScore,
        provenance: 'direct',
      },
    }

    expect(getAreaDomainSourceCounts(area)).toEqual({
      sourceApplied: 7,
      modelled: 1,
      missing: 0,
    })
    expect(getAreaPropertyEvidenceLabel(area)).toBe('Recent sold-price fallback')
    expect(describeMetricEvidence('direct_listing')).toBe('Current listings')
    expect(describeMetricEvidence('direct_listing_extended')).toBe('Current listings (extended area)')
    expect(describeMetricEvidence('direct_transactions_extended')).toBe(
      'Recent sold-price fallback (extended area)',
    )
    expect(describeMetricEvidence('direct_live_arrivals')).toBe('Live station arrivals')
  })
})
