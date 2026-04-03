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
  highlighted: boolean
  area: DerivedMicroArea
}

interface DistanceMetricScatterProps {
  areas: DerivedMicroArea[]
  centralCoordinate: Coordinate
  label: string
  fill?: string
  highlightFill?: string
  highlightedAreaIds?: string[]
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
  highlightFill = '#f97316',
  highlightedAreaIds = [],
  getValue,
  formatValue,
  unit = '',
  renderSelectedAreaDetail,
}: DistanceMetricScatterProps) => {
  const [selectedAreaId, setSelectedAreaId] = useState<string | null>(null)
  const highlightedSet = useMemo(() => new Set(highlightedAreaIds), [highlightedAreaIds])
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
        highlighted: highlightedSet.has(area.microAreaId),
        area,
      }
    })
    .filter((item): item is DistanceMetricPoint => item !== null)
  const baseData = data.filter((item) => !item.highlighted)
  const highlightedData = data.filter((item) => item.highlighted)

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
                    {point.highlighted ? (
                      <p className="text-amber-700">Included in current Filtered View shortlist.</p>
                    ) : null}
                    {renderSelectedAreaDetail ? (
                      <p className="mt-1 text-slate-500">Click the point to keep this area selected.</p>
                    ) : null}
                  </div>
                )
              }}
            />
            <Scatter
              data={baseData}
              fill={fill}
              onClick={(event) => {
                const point = (event as { payload?: DistanceMetricPoint } | undefined)?.payload
                if (point) {
                  setSelectedAreaId(point.id)
                }
              }}
            />
            {highlightedData.length > 0 ? (
              <Scatter
                data={highlightedData}
                fill={highlightFill}
                onClick={(event) => {
                  const point = (event as { payload?: DistanceMetricPoint } | undefined)?.payload
                  if (point) {
                    setSelectedAreaId(point.id)
                  }
                }}
              />
            ) : null}
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
      {highlightedData.length > 0 ? (
        <p className="text-xs text-slate-600">
          <span className="font-semibold" style={{ color: highlightFill }}>
            Highlighted dots
          </span>{' '}
          are areas currently included in the main Filtered View shortlist.
        </p>
      ) : null}
      {selectedPoint && renderSelectedAreaDetail ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
          {renderSelectedAreaDetail(selectedPoint.area)}
        </div>
      ) : null}
    </div>
  )
}
