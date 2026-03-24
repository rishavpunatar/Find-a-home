import type { Filters, Weights } from '@/types/domain'

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
  maxCommuteMinutes: 50,
  maxDriveMinutes: 20,
  minSchoolScore: 55,
  maxCrimeRatePerThousand: 82,
  maxPm25: 12,
  minGreenCoverPct: 22,
  maxMedianPrice: 825000,
  minDataConfidencePct: 60,
}

export const MAX_COMPARE_ITEMS = 5

export const STORAGE_KEYS = {
  weights: 'find-a-home.weights',
  filters: 'find-a-home.filters.default',
  filtersLondon: 'find-a-home.filters.london',
  pinned: 'find-a-home.pinned',
  compare: 'find-a-home.compare',
} as const
