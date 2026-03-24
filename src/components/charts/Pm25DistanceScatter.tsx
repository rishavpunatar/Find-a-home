import {
  CartesianGrid,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import type { Coordinate, DerivedMicroArea } from '@/types/domain'

const haversineKm = (a: Coordinate, b: Coordinate): number => {
  const radiusKm = 6371
  const lat1 = (a.lat * Math.PI) / 180
  const lon1 = (a.lon * Math.PI) / 180
  const lat2 = (b.lat * Math.PI) / 180
  const lon2 = (b.lon * Math.PI) / 180
  const dLat = lat2 - lat1
  const dLon = lon2 - lon1
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return radiusKm * 2 * Math.asin(Math.sqrt(h))
}

const computeDomain = (values: number[], padRatio = 0.06): [number, number] => {
  if (values.length === 0) {
    return [0, 1]
  }

  const minValue = Math.min(...values)
  const maxValue = Math.max(...values)
  if (minValue === maxValue) {
    const pad = Math.max(0.5, Math.abs(minValue) * 0.08)
    return [Math.max(0, minValue - pad), maxValue + pad]
  }

  const pad = (maxValue - minValue) * padRatio
  return [Math.max(0, minValue - pad), maxValue + pad]
}

interface Pm25DistanceScatterProps {
  areas: DerivedMicroArea[]
  centralCoordinate: Coordinate
}

export const Pm25DistanceScatter = ({ areas, centralCoordinate }: Pm25DistanceScatterProps) => {
  const data = areas
    .filter((area) => area.annualPm25.value !== null)
    .map((area) => ({
      x: haversineKm(area.centroid, centralCoordinate),
      y: area.annualPm25.value,
      station: area.stationName,
    }))

  const xDomain = computeDomain(data.map((item) => Number(item.x)))
  const yDomain = computeDomain(data.map((item) => Number(item.y)))

  return (
    <div className="h-[420px] w-full">
      <ResponsiveContainer>
        <ScatterChart margin={{ top: 12, right: 24, bottom: 26, left: 12 }}>
          <CartesianGrid />
          <XAxis
            type="number"
            dataKey="x"
            name="Distance to central London"
            unit=" km"
            domain={xDomain}
          />
          <YAxis type="number" dataKey="y" name="PM2.5" unit=" ug/m3" domain={yDomain} />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload || payload.length === 0) {
                return null
              }
              const point = payload[0]?.payload as { station: string; x: number; y: number } | undefined
              if (!point) {
                return null
              }
              return (
                <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs shadow">
                  <p className="font-semibold text-slate-900">{point.station}</p>
                  <p className="text-slate-700">Distance to central London: {point.x.toFixed(1)} km</p>
                  <p className="text-slate-700">PM2.5: {point.y.toFixed(1)} ug/m3</p>
                </div>
              )
            }}
          />
          <Scatter data={data} fill="#0ea5a5" />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  )
}
