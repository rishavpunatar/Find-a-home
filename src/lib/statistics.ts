export interface HistogramBin {
  start: number
  end: number
  count: number
}

export interface DistributionSummary {
  count: number
  mean: number
  variance: number
  standardDeviation: number
  min: number
  max: number
  bins: HistogramBin[]
}

const DEFAULT_BIN_COUNT = 12

export const summarizeDistribution = (
  values: number[],
  requestedBinCount = DEFAULT_BIN_COUNT,
): DistributionSummary | null => {
  const numericValues = values.filter((value) => Number.isFinite(value))

  if (numericValues.length === 0) {
    return null
  }

  const count = numericValues.length
  const mean = numericValues.reduce((sum, value) => sum + value, 0) / count
  const variance =
    numericValues.reduce((sum, value) => sum + (value - mean) ** 2, 0) / count
  const standardDeviation = Math.sqrt(variance)
  const min = Math.min(...numericValues)
  const max = Math.max(...numericValues)

  if (min === max) {
    return {
      count,
      mean,
      variance,
      standardDeviation,
      min,
      max,
      bins: [{ start: min, end: max, count }],
    }
  }

  const binCount = Math.max(4, Math.min(requestedBinCount, Math.ceil(Math.sqrt(count))))
  const binWidth = (max - min) / binCount
  const bins = Array.from({ length: binCount }, (_, index) => {
    const start = min + index * binWidth
    const end = index === binCount - 1 ? max : start + binWidth
    return { start, end, count: 0 }
  })

  for (const value of numericValues) {
    const rawIndex = Math.floor((value - min) / binWidth)
    const index = Math.min(binCount - 1, Math.max(0, rawIndex))
    const bin = bins[index]
    if (bin) {
      bin.count += 1
    }
  }

  return {
    count,
    mean,
    variance,
    standardDeviation,
    min,
    max,
    bins,
  }
}
