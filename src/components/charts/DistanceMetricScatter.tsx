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

import { computeNumericDomain, haversineKm } from './chartUtils'

interface DistanceMetricScatterProps {
  areas: DerivedMicroArea[]
  centralCoordinate: Coordinate
  label: string
  fill?: string
  getValue: (area: DerivedMicroArea) => number | null
  formatValue?: (value: number) => string
  unit?: string
}

export const DistanceMetricScatter = ({
  areas,
  centralCoordinate,
  label,
  fill = '#0f766e',
  getValue,
  formatValue,
  unit = '',
}: DistanceMetricScatterProps) => {
  const data = areas
    .map((area) => {
      const value = getValue(area)
      if (value === null) {
        return null
      }

      return {
        x: haversineKm(area.centroid, centralCoordinate),
        y: value,
        station: area.stationName,
      }
    })
    .filter((item): item is { x: number; y: number; station: string } => item !== null)

  const xDomain = computeNumericDomain(data.map((item) => item.x), { minFloor: 0 })
  const yDomain = computeNumericDomain(data.map((item) => item.y), { minFloor: 0 })
  const renderValue = formatValue ?? ((value: number) => `${value.toFixed(1)}${unit}`)

  return (
    <div className="h-[320px] w-full">
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
          <YAxis type="number" dataKey="y" name={label} domain={yDomain} />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload || payload.length === 0) {
                return null
              }
              const point = payload[0]?.payload as
                | { station: string; x: number; y: number }
                | undefined
              if (!point) {
                return null
              }
              return (
                <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs shadow">
                  <p className="font-semibold text-slate-900">{point.station}</p>
                  <p className="text-slate-700">Distance to central London: {point.x.toFixed(1)} km</p>
                  <p className="text-slate-700">
                    {label}: {renderValue(point.y)}
                  </p>
                </div>
              )
            }}
          />
          <Scatter data={data} fill={fill} />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  )
}
