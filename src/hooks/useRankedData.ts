import { useMemo } from 'react'

import { filterAreas } from '@/lib/filters'
import { rankMicroAreas } from '@/lib/scoring'
import type { DerivedMicroArea, Filters } from '@/types/domain'

import { useDataContext } from '@/context/DataContext'
import { useSettings } from '@/context/SettingsContext'

interface RankedDataResult {
  ranked: DerivedMicroArea[]
  filtered: DerivedMicroArea[]
  pinned: DerivedMicroArea[]
  compared: DerivedMicroArea[]
  effectiveFilters: Filters
}

interface RankedDataOptions {
  maxCommuteMinutesCap?: number
  ignoreMaxDriveMinutes?: boolean
  overrideFilters?: Filters
}

export const useRankedData = (options: RankedDataOptions = {}): RankedDataResult => {
  const { dataset } = useDataContext()
  const { normalizedWeights, filters, pinnedIds, compareIds } = useSettings()

  return useMemo(() => {
    const sourceFilters = options.overrideFilters ?? filters
    const effectiveFilters: Filters = {
      ...sourceFilters,
      maxCommuteMinutes:
        options.maxCommuteMinutesCap === undefined
          ? sourceFilters.maxCommuteMinutes
          : Math.min(sourceFilters.maxCommuteMinutes, options.maxCommuteMinutesCap),
    }

    if (!dataset) {
      return {
        ranked: [],
        filtered: [],
        pinned: [],
        compared: [],
        effectiveFilters,
      }
    }

    const ranked = rankMicroAreas(dataset.microAreas, normalizedWeights)
    const filtered = filterAreas(
      ranked,
      effectiveFilters,
      options.ignoreMaxDriveMinutes ? { ignoreMaxDriveMinutes: true } : {},
    )

    const byId = new Map(filtered.map((area) => [area.microAreaId, area]))

    const pinned = pinnedIds
      .map((id) => byId.get(id) ?? ranked.find((area) => area.microAreaId === id))
      .filter((area): area is DerivedMicroArea => Boolean(area))

    const compared = compareIds
      .map((id) => byId.get(id) ?? ranked.find((area) => area.microAreaId === id))
      .filter((area): area is DerivedMicroArea => Boolean(area))

    return {
      ranked,
      filtered,
      pinned,
      compared,
      effectiveFilters,
    }
  }, [
    compareIds,
    dataset,
    filters,
    normalizedWeights,
    options.ignoreMaxDriveMinutes,
    options.maxCommuteMinutesCap,
    options.overrideFilters,
    pinnedIds,
  ])
}
