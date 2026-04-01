import type { Coordinate } from '@/types/domain'

export const computeNumericDomain = (
  values: number[],
  {
    padRatio = 0.06,
    minFloor,
    maxCeil,
  }: { padRatio?: number; minFloor?: number; maxCeil?: number } = {},
): [number, number] => {
  if (values.length === 0) {
    return [minFloor ?? 0, maxCeil ?? 1]
  }

  const minValue = Math.min(...values)
  const maxValue = Math.max(...values)

  if (minValue === maxValue) {
    const pad = Math.max(0.5, Math.abs(minValue) * 0.08)
    return [
      minFloor === undefined ? minValue - pad : Math.max(minFloor, minValue - pad),
      maxCeil === undefined ? maxValue + pad : Math.min(maxCeil, maxValue + pad),
    ]
  }

  const pad = (maxValue - minValue) * padRatio
  return [
    minFloor === undefined ? minValue - pad : Math.max(minFloor, minValue - pad),
    maxCeil === undefined ? maxValue + pad : Math.min(maxCeil, maxValue + pad),
  ]
}

export const haversineKm = (left: Coordinate, right: Coordinate): number => {
  const radiusKm = 6371
  const lat1 = (left.lat * Math.PI) / 180
  const lon1 = (left.lon * Math.PI) / 180
  const lat2 = (right.lat * Math.PI) / 180
  const lon2 = (right.lon * Math.PI) / 180
  const dLat = lat2 - lat1
  const dLon = lon2 - lon1
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return radiusKm * 2 * Math.asin(Math.sqrt(h))
}
