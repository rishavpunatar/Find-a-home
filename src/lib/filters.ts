import type { DerivedMicroArea, Filters, MicroArea } from '@/types/domain'

const isAtMost = (value: number | null, max: number): boolean => value !== null && value <= max

const isAtLeast = (value: number | null, min: number): boolean => value !== null && value >= min

interface FilterOptions {
  ignoreMaxDriveMinutes?: boolean
}

export const matchesFilters = (
  area: MicroArea,
  filters: Filters,
  options: FilterOptions = {},
): boolean => {
  if (!isAtMost(area.commuteTypicalMinutes.value, filters.maxCommuteMinutes)) {
    return false
  }

  if (
    !options.ignoreMaxDriveMinutes &&
    !isAtMost(area.driveTimeToPinnerMinutes.value, filters.maxDriveMinutes)
  ) {
    return false
  }

  if (!isAtLeast(area.componentScores.schools, filters.minSchoolScore)) {
    return false
  }

  if (!isAtMost(area.crimeRatePerThousand.value, filters.maxCrimeRatePerThousand)) {
    return false
  }

  if (!isAtMost(area.annualNo2.value, filters.maxNo2)) {
    return false
  }

  if (!isAtLeast(area.greenCoverPct.value, filters.minGreenCoverPct)) {
    return false
  }

  if (!isAtMost(area.medianSemiDetachedPrice.value, filters.maxMedianPrice)) {
    return false
  }

  return true
}

export const filterAreas = (
  areas: DerivedMicroArea[],
  filters: Filters,
  options: FilterOptions = {},
): DerivedMicroArea[] => areas.filter((area) => matchesFilters(area, filters, options))
