const clamp = (value: number, minimum = 0, maximum = 100): number =>
  Math.max(minimum, Math.min(maximum, value))

const forwardScore = (value: number, minValue: number, maxValue: number): number => {
  if (maxValue <= minValue) {
    return 50
  }

  return clamp(((value - minValue) / (maxValue - minValue)) * 100)
}

const SCHOOL_ACCESS_SCALE = 10_000
export const DEFAULT_SCHOOL_ACCESS_POPULATION_DENOMINATOR = 25_650
const PRIMARY_ACCESS_MIN_PER_10K = 35
const PRIMARY_ACCESS_MAX_PER_10K = 150
const SECONDARY_ACCESS_MIN_PER_10K = 10
const SECONDARY_ACCESS_MAX_PER_10K = 40

export const schoolAccessPerPopulation = (
  schoolCount: number,
  populationDenominator: number | null | undefined,
): number => {
  const resolvedPopulationDenominator =
    populationDenominator !== null &&
    populationDenominator !== undefined &&
    populationDenominator > 0
      ? populationDenominator
      : DEFAULT_SCHOOL_ACCESS_POPULATION_DENOMINATOR

  return (schoolCount / resolvedPopulationDenominator) * SCHOOL_ACCESS_SCALE
}

export const totalSchoolAccessPerPopulation = (
  primaryCount: number,
  secondaryCount: number,
  populationDenominator: number | null | undefined,
): number => {
  const primaryPerPopulation = schoolAccessPerPopulation(primaryCount, populationDenominator)
  const secondaryPerPopulation = schoolAccessPerPopulation(secondaryCount, populationDenominator)

  return primaryPerPopulation + secondaryPerPopulation
}

export const schoolAccessSubscore = (
  primaryCount: number,
  secondaryCount: number,
  populationDenominator: number | null | undefined,
): number => {
  const primaryPerPopulation = schoolAccessPerPopulation(primaryCount, populationDenominator)
  const secondaryPerPopulation = schoolAccessPerPopulation(secondaryCount, populationDenominator)

  return (
    forwardScore(primaryPerPopulation, PRIMARY_ACCESS_MIN_PER_10K, PRIMARY_ACCESS_MAX_PER_10K) +
    forwardScore(secondaryPerPopulation, SECONDARY_ACCESS_MIN_PER_10K, SECONDARY_ACCESS_MAX_PER_10K)
  ) / 2
}
