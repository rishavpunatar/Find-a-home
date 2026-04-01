import {
  CartesianGrid,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useMemo, useState, type ReactNode } from 'react'

import type { Coordinate, DerivedMicroArea } from '@/types/domain'

import { computeNumericDomain, haversineKm } from './chartUtils'

interface DistanceMetricPoint {
  id: string
  x: number
  y: number
  station: string
  area: DerivedMicroArea
}

interface DistanceMetricScatterProps {
  areas: DerivedMicroArea[]
  centralCoordinate: Coordinate
  label: string
  fill?: string
  getValue: (area: DerivedMicroArea) => number | null
  formatValue?: (value: number) => string
  unit?: string
  renderSelectedAreaDetail?: (area: DerivedMicroArea) => ReactNode
}

export const DistanceMetricScatter = ({
  areas,
  centralCoordinate,
  label,
  fill = '#0f766e',
  getValue,
  formatValue,
  unit = '',
  renderSelectedAreaDetail,
}: DistanceMetricScatterProps) => {
  const [selectedAreaId, setSelectedAreaId] = useState<string | null>(null)
  const data = areas
    .map((area) => {
      const value = getValue(area)
      if (value === null) {
        return null
      }

      return {
        id: area.microAreaId,
        x: haversineKm(area.centroid, centralCoordinate),
        y: value,
        station: area.stationName,
        area,
      }
    })
    .filter((item): item is DistanceMetricPoint => item !== null)

  const xDomain = computeNumericDomain(data.map((item) => item.x), { minFloor: 0 })
  const yDomain = computeNumericDomain(data.map((item) => item.y), { minFloor: 0 })
  const renderValue = formatValue ?? ((value: number) => `${value.toFixed(1)}${unit}`)
  const selectedPoint = useMemo(
    () => data.find((item) => item.id === selectedAreaId) ?? null,
    [data, selectedAreaId],
  )

  return (
    <div className="space-y-3">
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
                const point = payload[0]?.payload as DistanceMetricPoint | undefined
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
                    {renderSelectedAreaDetail ? (
                      <p className="mt-1 text-slate-500">Click the point to keep this area selected.</p>
                    ) : null}
                  </div>
                )
              }}
            />
            <Scatter
              data={data}
              fill={fill}
              onClick={(event) => {
                const point = (event as { payload?: DistanceMetricPoint } | undefined)?.payload
                if (point) {
                  setSelectedAreaId(point.id)
                }
              }}
            />
            {selectedPoint ? (
              <Scatter
                data={[selectedPoint]}
                fill="#0f172a"
                shape={(props: { cx?: number | undefined; cy?: number | undefined }) => (
                  <circle
                    cx={props.cx}
                    cy={props.cy}
                    r={7}
                    fill="white"
                    stroke="#0f172a"
                    strokeWidth={3}
                  />
                )}
              />
            ) : null}
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      {selectedPoint && renderSelectedAreaDetail ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
          {renderSelectedAreaDetail(selectedPoint.area)}
        </div>
      ) : null}
    </div>
  )
}
