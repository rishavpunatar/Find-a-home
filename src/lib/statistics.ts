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

const sortNumeric = (values: number[]): number[] =>
  values.filter((value) => Number.isFinite(value)).sort((left, right) => left - right)

export const quantile = (values: number[], percentile: number): number | null => {
  const sortedValues = sortNumeric(values)
  if (sortedValues.length === 0) {
    return null
  }

  if (sortedValues.length === 1) {
    return sortedValues[0] ?? null
  }

  const clampedPercentile = Math.max(0, Math.min(1, percentile))
  const position = (sortedValues.length - 1) * clampedPercentile
  const lowerIndex = Math.floor(position)
  const upperIndex = Math.ceil(position)
  const lowerValue = sortedValues[lowerIndex]
  const upperValue = sortedValues[upperIndex]

  if (lowerValue === undefined || upperValue === undefined) {
    return null
  }

  if (lowerIndex === upperIndex) {
    return lowerValue
  }

  const weight = position - lowerIndex
  return lowerValue + (upperValue - lowerValue) * weight
}

export const median = (values: number[]): number | null => quantile(values, 0.5)

export const interquartileRange = (values: number[]): number | null => {
  const q1 = quantile(values, 0.25)
  const q3 = quantile(values, 0.75)
  if (q1 === null || q3 === null) {
    return null
  }
  return q3 - q1
}

export const medianAbsoluteDeviation = (values: number[]): number | null => {
  const center = median(values)
  if (center === null) {
    return null
  }

  const deviations = values
    .filter((value) => Number.isFinite(value))
    .map((value) => Math.abs(value - center))

  return median(deviations)
}

export const summarizeDistribution = (
  values: number[],
  requestedBinCount = DEFAULT_BIN_COUNT,
): DistributionSummary | null => {
  const numericValues = sortNumeric(values)

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
