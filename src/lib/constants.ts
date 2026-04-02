import type { Filters, Weights } from '@/types/domain'

export const DEFAULT_WEIGHTS: Weights = {
  value: 32,
  transport: 20,
  schools: 23,
  environment: 15,
  crime: 10,
}

export const DEFAULT_FILTERS: Filters = {
  maxCommuteMinutes: 70,
  maxDriveMinutes: 90,
  maxMedianPrice: 950000,
}

export const MAX_COMPARE_ITEMS = 5

export const HIGH_CONFIDENCE_MIN_CONFIDENCE_PCT = 65

export const FILTER_PRESETS = {
  focus: {
    label: 'Focus',
    description: 'Tighter shortlist with stronger commute, access back to Pinner, and price discipline.',
    filters: {
      maxCommuteMinutes: 60,
      maxDriveMinutes: 50,
      maxMedianPrice: 900000,
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
      maxDriveMinutes: 120,
      maxMedianPrice: 1200000,
    },
  },
} as const

export type FilterPresetKey = keyof typeof FILTER_PRESETS

export const FILTER_PRESET_ORDER: FilterPresetKey[] = ['focus', 'balanced', 'explore']

export const STORAGE_KEYS = {
  weights: 'find-a-home.v2.weights',
  weightingMode: 'find-a-home.v2.weighting-mode',
  filters: 'find-a-home.v4.filters.default',
  filtersLondon: 'find-a-home.v4.filters.london',
  pinned: 'find-a-home.pinned',
  compare: 'find-a-home.compare',
} as const
