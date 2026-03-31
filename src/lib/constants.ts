import type { Filters, QualityMode, Weights } from '@/types/domain'

export const DEFAULT_WEIGHTS: Weights = {
  value: 30,
  transport: 15,
  schools: 20,
  environment: 15,
  crime: 12.5,
  proximity: 5,
  planningRisk: 2.5,
}

export const DEFAULT_FILTERS: Filters = {
  maxCommuteMinutes: 65,
  maxDriveMinutes: 40,
  minSchoolScore: 48,
  maxCrimeRatePerThousand: 95,
  maxPm25: 14,
  minGreenCoverPct: 16,
  maxMedianPrice: 950000,
  minDataConfidencePct: 45,
}

export const MAX_COMPARE_ITEMS = 5

export const HIGH_CONFIDENCE_MIN_CONFIDENCE_PCT = 65

export const DEFAULT_QUALITY_MODE: QualityMode = 'all'

export const FILTER_PRESETS = {
  focus: {
    label: 'Focus',
    description: 'Tighter shortlist around stronger commute, schools, and confidence.',
    filters: {
      maxCommuteMinutes: 58,
      maxDriveMinutes: 32,
      minSchoolScore: 52,
      maxCrimeRatePerThousand: 88,
      maxPm25: 12.8,
      minGreenCoverPct: 19,
      maxMedianPrice: 900000,
      minDataConfidencePct: 52,
    },
  },
  balanced: {
    label: 'Balanced',
    description: 'Broader default shortlist with enough depth for ranking and charts.',
    filters: DEFAULT_FILTERS,
  },
  explore: {
    label: 'Explore',
    description: 'Broad scan mode for discovery before tightening constraints.',
    filters: {
      maxCommuteMinutes: 70,
      maxDriveMinutes: 60,
      minSchoolScore: 35,
      maxCrimeRatePerThousand: 110,
      maxPm25: 16,
      minGreenCoverPct: 10,
      maxMedianPrice: 1200000,
      minDataConfidencePct: 35,
    },
  },
} as const

export type FilterPresetKey = keyof typeof FILTER_PRESETS

export const FILTER_PRESET_ORDER: FilterPresetKey[] = ['focus', 'balanced', 'explore']

export const STORAGE_KEYS = {
  weights: 'find-a-home.weights',
  filters: 'find-a-home.v2.filters.default',
  filtersLondon: 'find-a-home.v2.filters.london',
  qualityMode: 'find-a-home.v2.quality.default',
  qualityModeLondon: 'find-a-home.v2.quality.london',
  pinned: 'find-a-home.pinned',
  compare: 'find-a-home.compare',
} as const
