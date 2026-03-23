import { useMemo } from 'react'

import { filterAreas } from '@/lib/filters'
import { rankMicroAreas } from '@/lib/scoring'
import type { DerivedMicroArea } from '@/types/domain'

import { useDataContext } from '@/context/DataContext'
import { useSettings } from '@/context/SettingsContext'

interface RankedDataResult {
  ranked: DerivedMicroArea[]
  filtered: DerivedMicroArea[]
  pinned: DerivedMicroArea[]
  compared: DerivedMicroArea[]
}

export const useRankedData = (): RankedDataResult => {
  const { dataset } = useDataContext()
  const { normalizedWeights, filters, pinnedIds, compareIds } = useSettings()

  return useMemo(() => {
    if (!dataset) {
      return {
        ranked: [],
        filtered: [],
        pinned: [],
        compared: [],
      }
    }

    const ranked = rankMicroAreas(dataset.microAreas, normalizedWeights)
    const filtered = filterAreas(ranked, filters)

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
    }
  }, [compareIds, dataset, filters, normalizedWeights, pinnedIds])
}
