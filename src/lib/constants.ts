import type { Filters, Weights } from '@/types/domain'

export const DEFAULT_WEIGHTS: Weights = {
  transport: 26,
  schools: 31,
  environment: 20,
  crime: 13,
  roads: 10,
}

export const DEFAULT_FILTERS: Filters = {
  maxCommuteMinutes: 60,
  maxDriveMinutes: 90,
  maxMedianSemiDetachedPrice: 8_000_000,
}

export const MAX_COMPARE_ITEMS = 5

export const HIGH_CONFIDENCE_MIN_CONFIDENCE_PCT = 65

export const FILTER_PRESETS = {
  focus: {
    label: 'Focus',
    description: 'Tighter shortlist with stronger commute discipline and faster access back to Pinner.',
    filters: {
      maxCommuteMinutes: 50,
      maxDriveMinutes: 50,
      maxMedianSemiDetachedPrice: DEFAULT_FILTERS.maxMedianSemiDetachedPrice,
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
      maxCommuteMinutes: 60,
      maxDriveMinutes: 120,
      maxMedianSemiDetachedPrice: DEFAULT_FILTERS.maxMedianSemiDetachedPrice,
    },
  },
} as const

export type FilterPresetKey = keyof typeof FILTER_PRESETS

export const FILTER_PRESET_ORDER: FilterPresetKey[] = ['focus', 'balanced', 'explore']

export const STORAGE_KEYS = {
  weights: 'find-a-home.v4.weights',
  weightingMode: 'find-a-home.v2.weighting-mode',
  filters: 'find-a-home.v7.filters.default',
  filtersLondon: 'find-a-home.v7.filters.london',
  pinned: 'find-a-home.pinned',
  compare: 'find-a-home.compare',
} as const
