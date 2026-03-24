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
  boroughQolScore: NumericMetric
  boroughQolAuthority: string
  boroughQolPeriod: string
  boroughQolMethodology: string

  componentScores: ComponentScores
  overallWeightedScore: number
  rankingExplanationRules: string[]
}

export interface ProcessedDataset {
  generatedAt: string
  methodologyVersion: string
  destinationStation: string
  londonWideExcludedByCommute?: Array<{
    stationCode: string
    stationName: string
    typicalCommuteMinutes: number
  }>
  verificationSummary?: {
    overallStatus: string
    crimeCrossCheckStatus: string
    dataQualityStatus?: string
    qualityCriticalIssues?: number
    qualityWarningIssues?: number
    liveMode: boolean
    generatedAt: string
  }
  config: {
    pinnerCoordinate: Coordinate
    centralLondonCoordinate: Coordinate
    stationSearchRadiusKm: number
    microAreaWalkRadiusM: number
    maxCommuteMinutesForCandidate: number
    maxDriveMinutesForCandidate: number
    londonWideMaxCommuteMinutesForCandidate?: number
    londonWideUsesPinnerRadiusPrefilter?: boolean
    londonWideUsesDriveToPinnerPrefilter?: boolean
    londonWideSourceStationCount?: number
    londonWideExcludedByCommuteCount?: number
    boroughQolSource?: {
      name?: string
      dataset?: string
      csvUrl?: string
      metadataUrl?: string
      releaseDate?: string
      accrualPeriodicity?: string
      coveragePeriod?: string
      generatedAt?: string
    }
  }
  microAreas: MicroArea[]
  londonWideMicroAreas?: MicroArea[]
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
  maxPm25: number
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
