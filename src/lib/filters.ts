import type { DerivedMicroArea, Filters, MicroArea } from '@/types/domain'

const isAtMost = (value: number | null, max: number): boolean => value !== null && value <= max

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

  if (!isAtMost(area.medianSemiDetachedPrice.value, filters.maxMedianSemiDetachedPrice)) {
    return false
  }

  return true
}

export const filterAreas = (
  areas: DerivedMicroArea[],
  filters: Filters,
  options: FilterOptions = {},
): DerivedMicroArea[] => areas.filter((area) => matchesFilters(area, filters, options))
