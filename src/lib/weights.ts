import type { Weights } from '@/types/domain'

import { DEFAULT_WEIGHTS } from './constants'

const weightKeys = Object.keys(DEFAULT_WEIGHTS) as (keyof Weights)[]

const roundTo = (value: number, decimals = 2): number => {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

export const normalizeWeights = (weights: Weights): Weights => {
  const total = weightKeys.reduce((sum, key) => sum + Math.max(weights[key], 0), 0)

  if (total <= 0) {
    return { ...DEFAULT_WEIGHTS }
  }

  return weightKeys.reduce((acc, key) => {
    acc[key] = roundTo((Math.max(weights[key], 0) / total) * 100)
    return acc
  }, {} as Weights)
}

export const weightsSum = (weights: Weights): number =>
  weightKeys.reduce((sum, key) => sum + weights[key], 0)

export const clampWeight = (value: number): number =>
  Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0
