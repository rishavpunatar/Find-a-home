const inverseScore = (value: number, best: number, worst: number): number => {
  if (worst <= best) {
    return 50
  }

  return Math.max(0, Math.min(100, ((worst - value) / (worst - best)) * 100))
}

export { schoolAccessSubscore } from './schoolAccess'

export const crimeDiagnosticScore = (crimeRatePerThousand: number): number =>
  inverseScore(crimeRatePerThousand, 25, 130)

export const proximityDiagnosticScore = (driveToPinnerMinutes: number): number =>
  inverseScore(driveToPinnerMinutes, 2, 30)
