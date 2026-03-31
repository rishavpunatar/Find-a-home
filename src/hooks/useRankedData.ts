import { useMemo } from 'react'

import { isHighConfidenceArea } from '@/lib/dataQuality'
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
  scope?: 'default' | 'londonWide'
}

export const useRankedData = (options: RankedDataOptions = {}): RankedDataResult => {
  const { dataset } = useDataContext()
  const {
    normalizedWeights,
    filters,
    londonFilters,
    qualityMode,
    londonQualityMode,
    pinnedIds,
    compareIds,
  } = useSettings()

  return useMemo(() => {
    const scopedFilters = options.scope === 'londonWide' ? londonFilters : filters
    const scopedQualityMode = options.scope === 'londonWide' ? londonQualityMode : qualityMode
    const sourceFilters = options.overrideFilters ?? scopedFilters
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

    const sourceAreas =
      options.scope === 'londonWide'
        ? (dataset.londonWideMicroAreas ?? dataset.microAreas)
        : dataset.microAreas
    const ranked = rankMicroAreas(sourceAreas, normalizedWeights)
    const filteredByConstraints = filterAreas(
      ranked,
      effectiveFilters,
      options.ignoreMaxDriveMinutes ? { ignoreMaxDriveMinutes: true } : {},
    )
    const filtered =
      scopedQualityMode === 'highConfidence'
        ? filteredByConstraints.filter((area) => isHighConfidenceArea(area))
        : filteredByConstraints

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
    londonQualityMode,
    londonFilters,
    normalizedWeights,
    options.ignoreMaxDriveMinutes,
    options.maxCommuteMinutesCap,
    options.overrideFilters,
    options.scope,
    pinnedIds,
    qualityMode,
  ])
}
