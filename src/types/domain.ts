export type MetricStatus = 'available' | 'estimated' | 'placeholder' | 'missing'

export interface NumericMetric {
  value: number | null
  unit: string
  status: MetricStatus
  confidence: number
  provenance?: string
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
  transport: number
  schools: number
  environment: number
  crime: number
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
  populationDenominator?: number | null

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
    sourceCoverageScore?: number
    verificationStrengthScore?: number
    verificationCompletenessScore?: number
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
    primaryScopeRegion?: string
    microAreaWalkRadiusM: number
    maxCommuteMinutesForCandidate: number
    maxDriveMinutesForCandidate: number
    defaultUsesPinnerRadiusPrefilter?: boolean
    defaultUsesDriveToPinnerPrefilter?: boolean
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
    sourceMetadata?: Record<
      string,
      {
        source?: string
        referencePeriod?: string
        releaseDate?: string
      }
    >
    stationUniverse?: {
      rawStationCount?: number
      keptStationCount?: number
      excludedStationCount?: number
      excludedSample?: Array<{
        stationCode?: string
        stationName?: string
        reason?: string
      }>
    }
  }
  microAreas: MicroArea[]
  londonWideMicroAreas?: MicroArea[]
}

export interface Weights {
  transport: number
  schools: number
  environment: number
  crime: number
}

export type WeightingMode = 'manual' | 'varianceAwareDefaults'

export interface Filters {
  maxCommuteMinutes: number
  maxDriveMinutes: number
  maxMedianSemiDetachedPrice: number
}

export type SortDirection = 'asc' | 'desc'

export interface SortConfig {
  key: string
  direction: SortDirection
}

export interface DerivedMicroArea extends MicroArea {
  dynamicOverallScore: number
  overallRank: number
}
