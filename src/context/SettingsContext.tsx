import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

import type { Filters, WeightingMode, Weights } from '@/types/domain'

import {
  DEFAULT_FILTERS,
  DEFAULT_WEIGHTS,
  FILTER_PRESETS,
  type FilterPresetKey,
  MAX_COMPARE_ITEMS,
  STORAGE_KEYS,
} from '@/lib/constants'
import { clampWeight, buildVarianceAwareDefaultWeights, normalizeWeights } from '@/lib/weights'
import { useDataContext } from './DataContext'

interface SettingsContextValue {
  rawWeights: Weights
  activeWeights: Weights
  normalizedWeights: Weights
  weightingMode: WeightingMode
  filters: Filters
  londonFilters: Filters
  pinnedIds: string[]
  compareIds: string[]
  updateWeight: (key: keyof Weights, nextValue: number) => void
  resetWeights: () => void
  setWeightingMode: (mode: WeightingMode) => void
  updateFilter: <K extends keyof Filters>(
    key: K,
    value: Filters[K],
    scope?: 'default' | 'londonWide',
  ) => void
  applyFilterPreset: (preset: FilterPresetKey, scope?: 'default' | 'londonWide') => void
  resetFilters: (scope?: 'default' | 'londonWide') => void
  resetRankingView: (scope?: 'default' | 'londonWide') => void
  togglePin: (id: string) => void
  toggleCompare: (id: string) => void
}

const SettingsContext = createContext<SettingsContextValue | null>(null)

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const parseLocalStorageValue = (key: string): unknown => {
  if (typeof window === 'undefined') {
    return null
  }

  const stored = window.localStorage.getItem(key)

  if (!stored) {
    return null
  }

  try {
    return JSON.parse(stored) as unknown
  } catch {
    return null
  }
}

const parseArray = (key: string): string[] => {
  const parsed = parseLocalStorageValue(key)
  if (!Array.isArray(parsed)) {
    return []
  }

  return [...new Set(parsed.filter((value): value is string => typeof value === 'string'))]
}

const parseWeights = (): Weights => {
  const parsed = parseLocalStorageValue(STORAGE_KEYS.weights)
  if (!isRecord(parsed)) {
    return DEFAULT_WEIGHTS
  }

  return (Object.keys(DEFAULT_WEIGHTS) as (keyof Weights)[]).reduce(
    (weights, key) => ({
      ...weights,
      [key]:
        typeof parsed[key] === 'number' && Number.isFinite(parsed[key])
          ? clampWeight(parsed[key])
          : DEFAULT_WEIGHTS[key],
    }),
    { ...DEFAULT_WEIGHTS },
  )
}

const parseFilters = (key: typeof STORAGE_KEYS.filters | typeof STORAGE_KEYS.filtersLondon): Filters => {
  const parsed = parseLocalStorageValue(key)
  if (!isRecord(parsed)) {
    return DEFAULT_FILTERS
  }

  return (Object.keys(DEFAULT_FILTERS) as (keyof Filters)[]).reduce(
    (filters, filterKey) => ({
      ...filters,
      [filterKey]:
        typeof parsed[filterKey] === 'number' && Number.isFinite(parsed[filterKey])
          ? Number(parsed[filterKey])
          : DEFAULT_FILTERS[filterKey],
    }),
    { ...DEFAULT_FILTERS },
  )
}

const parseWeightingMode = (): WeightingMode => {
  const parsed = parseLocalStorageValue(STORAGE_KEYS.weightingMode)
  return parsed === 'varianceAwareDefaults' ? 'varianceAwareDefaults' : 'manual'
}

export const SettingsProvider = ({ children }: { children: ReactNode }) => {
  const { dataset } = useDataContext()
  const [rawWeights, setRawWeights] = useState<Weights>(parseWeights)
  const [weightingMode, setWeightingModeState] = useState<WeightingMode>(parseWeightingMode)
  const [filters, setFilters] = useState<Filters>(() => parseFilters(STORAGE_KEYS.filters))
  const [londonFilters, setLondonFilters] = useState<Filters>(() => parseFilters(STORAGE_KEYS.filtersLondon))
  const [pinnedIds, setPinnedIds] = useState<string[]>(() => parseArray(STORAGE_KEYS.pinned))
  const [compareIds, setCompareIds] = useState<string[]>(() => parseArray(STORAGE_KEYS.compare))

  const varianceAwareDefaultWeights = useMemo(
    () =>
      buildVarianceAwareDefaultWeights(dataset?.londonWideMicroAreas ?? dataset?.microAreas ?? []),
    [dataset],
  )

  const activeWeights = useMemo(
    () => (weightingMode === 'varianceAwareDefaults' ? varianceAwareDefaultWeights : rawWeights),
    [rawWeights, varianceAwareDefaultWeights, weightingMode],
  )

  const normalizedWeights = useMemo(() => normalizeWeights(activeWeights), [activeWeights])

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEYS.weights, JSON.stringify(rawWeights))
  }, [rawWeights])

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEYS.weightingMode, JSON.stringify(weightingMode))
  }, [weightingMode])

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEYS.filters, JSON.stringify(filters))
  }, [filters])

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEYS.filtersLondon, JSON.stringify(londonFilters))
  }, [londonFilters])

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEYS.pinned, JSON.stringify(pinnedIds))
  }, [pinnedIds])

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEYS.compare, JSON.stringify(compareIds))
  }, [compareIds])

  const updateWeight = useCallback(
    (key: keyof Weights, nextValue: number) => {
      setRawWeights((current) => {
        const base =
          weightingMode === 'varianceAwareDefaults' ? varianceAwareDefaultWeights : current
        return { ...base, [key]: clampWeight(nextValue) }
      })
      setWeightingModeState('manual')
    },
    [varianceAwareDefaultWeights, weightingMode],
  )

  const resetWeights = useCallback(() => {
    setRawWeights(DEFAULT_WEIGHTS)
    setWeightingModeState('manual')
  }, [])

  const setWeightingMode = useCallback((mode: WeightingMode) => {
    setWeightingModeState(mode)
  }, [])

  const updateFilter = useCallback(
    <K extends keyof Filters>(
      key: K,
      value: Filters[K],
      scope: 'default' | 'londonWide' = 'default',
    ) => {
      if (scope === 'londonWide') {
        setLondonFilters((current) => ({ ...current, [key]: value }))
        return
      }
      setFilters((current) => ({ ...current, [key]: value }))
    },
    [],
  )

  const applyFilterPreset = useCallback(
    (preset: FilterPresetKey, scope: 'default' | 'londonWide' = 'default') => {
      const nextFilters = { ...FILTER_PRESETS[preset].filters }
      if (scope === 'londonWide') {
        setLondonFilters(nextFilters)
        return
      }
      setFilters(nextFilters)
    },
    [],
  )

  const resetFilters = useCallback((scope: 'default' | 'londonWide' = 'default') => {
    if (scope === 'londonWide') {
      setLondonFilters({ ...DEFAULT_FILTERS })
      return
    }
    setFilters({ ...DEFAULT_FILTERS })
  }, [])

  const resetRankingView = useCallback(
    (scope: 'default' | 'londonWide' = 'default') => {
      resetFilters(scope)
    },
    [resetFilters],
  )

  const togglePin = useCallback((id: string) => {
    setPinnedIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    )
  }, [])

  const toggleCompare = useCallback((id: string) => {
    setCompareIds((current) => {
      if (current.includes(id)) {
        return current.filter((item) => item !== id)
      }

      if (current.length >= MAX_COMPARE_ITEMS) {
        return current
      }

      return [...current, id]
    })
  }, [])

  const value = useMemo(
    () => ({
      rawWeights,
      activeWeights,
      normalizedWeights,
      weightingMode,
      filters,
      londonFilters,
      pinnedIds,
      compareIds,
      updateWeight,
      resetWeights,
      setWeightingMode,
      updateFilter,
      applyFilterPreset,
      resetFilters,
      resetRankingView,
      togglePin,
      toggleCompare,
    }),
    [
      applyFilterPreset,
      compareIds,
      filters,
      londonFilters,
      normalizedWeights,
      pinnedIds,
      rawWeights,
      activeWeights,
      resetFilters,
      resetRankingView,
      resetWeights,
      setWeightingMode,
      toggleCompare,
      togglePin,
      updateFilter,
      updateWeight,
      weightingMode,
    ],
  )

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}

export const useSettings = (): SettingsContextValue => {
  const value = useContext(SettingsContext)

  if (!value) {
    throw new Error('useSettings must be used within SettingsProvider')
  }

  return value
}
