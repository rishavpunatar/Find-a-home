import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

import type { Filters, Weights } from '@/types/domain'

import { DEFAULT_FILTERS, DEFAULT_WEIGHTS, MAX_COMPARE_ITEMS, STORAGE_KEYS } from '@/lib/constants'
import { clampWeight, normalizeWeights } from '@/lib/weights'

interface SettingsContextValue {
  rawWeights: Weights
  normalizedWeights: Weights
  filters: Filters
  londonFilters: Filters
  pinnedIds: string[]
  compareIds: string[]
  updateWeight: (key: keyof Weights, nextValue: number) => void
  resetWeights: () => void
  updateFilter: <K extends keyof Filters>(
    key: K,
    value: Filters[K],
    scope?: 'default' | 'londonWide',
  ) => void
  resetFilters: (scope?: 'default' | 'londonWide') => void
  togglePin: (id: string) => void
  toggleCompare: (id: string) => void
}

const SettingsContext = createContext<SettingsContextValue | null>(null)

const parseLocalStorage = <T,>(key: string, fallback: T): T => {
  if (typeof window === 'undefined') {
    return fallback
  }

  const stored = window.localStorage.getItem(key)

  if (!stored) {
    return fallback
  }

  try {
    const parsed: unknown = JSON.parse(stored)
    if (typeof parsed !== 'object' || parsed === null) {
      return fallback
    }

    return { ...fallback, ...(parsed as Partial<T>) }
  } catch {
    return fallback
  }
}

const parseArray = (key: string): string[] => {
  if (typeof window === 'undefined') {
    return []
  }

  const stored = window.localStorage.getItem(key)

  if (!stored) {
    return []
  }

  try {
    const parsed = JSON.parse(stored) as unknown
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === 'string')
      : []
  } catch {
    return []
  }
}

export const SettingsProvider = ({ children }: { children: ReactNode }) => {
  const [rawWeights, setRawWeights] = useState<Weights>(() =>
    parseLocalStorage<Weights>(STORAGE_KEYS.weights, DEFAULT_WEIGHTS),
  )
  const [filters, setFilters] = useState<Filters>(() =>
    parseLocalStorage<Filters>(STORAGE_KEYS.filters, DEFAULT_FILTERS),
  )
  const [londonFilters, setLondonFilters] = useState<Filters>(() =>
    parseLocalStorage<Filters>(STORAGE_KEYS.filtersLondon, DEFAULT_FILTERS),
  )
  const [pinnedIds, setPinnedIds] = useState<string[]>(() => parseArray(STORAGE_KEYS.pinned))
  const [compareIds, setCompareIds] = useState<string[]>(() => parseArray(STORAGE_KEYS.compare))

  const normalizedWeights = useMemo(() => normalizeWeights(rawWeights), [rawWeights])

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEYS.weights, JSON.stringify(rawWeights))
  }, [rawWeights])

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

  const updateWeight = useCallback((key: keyof Weights, nextValue: number) => {
    setRawWeights((current) => ({ ...current, [key]: clampWeight(nextValue) }))
  }, [])

  const resetWeights = useCallback(() => {
    setRawWeights(DEFAULT_WEIGHTS)
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

  const resetFilters = useCallback((scope: 'default' | 'londonWide' = 'default') => {
    if (scope === 'londonWide') {
      setLondonFilters(DEFAULT_FILTERS)
      return
    }
    setFilters(DEFAULT_FILTERS)
  }, [])

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
      normalizedWeights,
      filters,
      londonFilters,
      pinnedIds,
      compareIds,
      updateWeight,
      resetWeights,
      updateFilter,
      resetFilters,
      togglePin,
      toggleCompare,
    }),
    [
      compareIds,
      filters,
      londonFilters,
      normalizedWeights,
      pinnedIds,
      rawWeights,
      resetFilters,
      resetWeights,
      toggleCompare,
      togglePin,
      updateFilter,
      updateWeight,
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
