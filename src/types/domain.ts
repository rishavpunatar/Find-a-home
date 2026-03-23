export type MetricStatus = 'available' | 'estimated' | 'placeholder' | 'missing'

export interface NumericMetric {
  value: number | null
  unit: string
  status: MetricStatus
  confidence: number
  methodologyNote: string
  lastUpdated: string
}

export interface Coordinate {
  lat: number
  lon: number
}

export interface Catchment {
  type: 'circle'
  radiusMeters: number
}

export interface ComponentScores {
  value: number
  transport: number
  schools: number
  environment: number
  crime: number
  proximity: number
  planningRisk: number
}

export interface MicroArea {
  microAreaId: string
  stationCode: string
  stationName: string
  operator: string
  lines: string[]
  localAuthority: string
  countyOrBorough: string
  centroid: Coordinate
  catchment: Catchment
  overlapConfidence: number
  dataConfidenceScore: number
  confidenceNotes: string[]
  flags: string[]

  averageSemiDetachedPrice: NumericMetric
  medianSemiDetachedPrice: NumericMetric
  semiPriceTrendPct5y: NumericMetric
  affordabilityScore: NumericMetric
  valueForMoneyScore: NumericMetric

  walkCatchmentAssumption: string
  commuteDestination: string
  commuteTypicalMinutes: NumericMetric
  commutePeakMinutes: NumericMetric
  commuteOffPeakMinutes: NumericMetric
  serviceFrequencyPeakTph: NumericMetric
  interchangeCount: NumericMetric
  driveTimeToPinnerMinutes: NumericMetric

  nearbyPrimaryCount: NumericMetric
  nearbySecondaryCount: NumericMetric
  primaryQualityScore: NumericMetric
  secondaryQualityScore: NumericMetric
  schoolMethodologyNotes: string

  annualNo2: NumericMetric
  annualPm25: NumericMetric
  greenSpaceAreaKm2Within1km: NumericMetric
  greenCoverPct: NumericMetric
  nearestParkDistanceM: NumericMetric

  crimeRatePerThousand: NumericMetric
  crimeCategoryBreakdown?: Record<string, number>

  planningRiskHeuristic: NumericMetric
  planningRiskMethodology: string

  componentScores: ComponentScores
  overallWeightedScore: number
  rankingExplanationRules: string[]
}

export interface ProcessedDataset {
  generatedAt: string
  methodologyVersion: string
  destinationStation: string
  verificationSummary?: {
    overallStatus: string
    crimeCrossCheckStatus: string
    liveMode: boolean
    generatedAt: string
  }
  config: {
    pinnerCoordinate: Coordinate
    stationSearchRadiusKm: number
    microAreaWalkRadiusM: number
    maxCommuteMinutesForCandidate: number
    maxDriveMinutesForCandidate: number
  }
  microAreas: MicroArea[]
}

export interface Weights {
  value: number
  transport: number
  schools: number
  environment: number
  crime: number
  proximity: number
  planningRisk: number
}

export interface Filters {
  maxCommuteMinutes: number
  maxDriveMinutes: number
  minSchoolScore: number
  maxCrimeRatePerThousand: number
  maxNo2: number
  minGreenCoverPct: number
  maxMedianPrice: number
}

export type SortDirection = 'asc' | 'desc'

export interface SortConfig {
  key: string
  direction: SortDirection
}

export interface DerivedMicroArea extends MicroArea {
  dynamicOverallScore: number
}
