const clamp = (value: number, minimum = 0, maximum = 100): number =>
  Math.max(minimum, Math.min(maximum, value))

const forwardScore = (value: number, minValue: number, maxValue: number): number => {
  if (maxValue <= minValue) {
    return 50
  }

  return clamp(((value - minValue) / (maxValue - minValue)) * 100)
}

const inverseScore = (value: number, best: number, worst: number): number => {
  if (worst <= best) {
    return 50
  }

  return clamp(((worst - value) / (worst - best)) * 100)
}

export const schoolAccessSubscore = (primaryCount: number, secondaryCount: number): number =>
  (forwardScore(primaryCount, 1, 18) + forwardScore(secondaryCount, 1, 8)) / 2

export const crimeDiagnosticScore = (crimeRatePerThousand: number): number =>
  inverseScore(crimeRatePerThousand, 25, 130)

export const proximityDiagnosticScore = (driveToPinnerMinutes: number): number =>
  inverseScore(driveToPinnerMinutes, 2, 30)

export const planningDiagnosticScore = (planningRisk: number): number =>
  inverseScore(planningRisk, 15, 80)
