import { useMemo, useState } from 'react'
import {
  CartesianGrid,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import type { DerivedMicroArea } from '@/types/domain'

import { formatCurrency, formatNumber } from '@/lib/format'

import { computeNumericDomain } from './chartUtils'

interface PriceScorePoint {
  id: string
  x: number
  y: number
  station: string
  area: DerivedMicroArea
}

interface PriceScoreScatterProps {
  areas: DerivedMicroArea[]
}

export const PriceScoreScatter = ({ areas }: PriceScoreScatterProps) => {
  const [selectedAreaId, setSelectedAreaId] = useState<string | null>(null)

  const data = areas
    .filter((area) => area.medianSemiDetachedPrice.value !== null)
    .map((area) => ({
      id: area.microAreaId,
      x: area.medianSemiDetachedPrice.value as number,
      y: area.dynamicOverallScore,
      station: area.stationName,
      area,
    }))

  const xDomain = computeNumericDomain(data.map((item) => item.x), { minFloor: 0 })
  const yDomain = computeNumericDomain(data.map((item) => item.y), { minFloor: 0, maxCeil: 100 })
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
              name="Median semi-detached price"
              domain={xDomain}
              tickFormatter={(value) => formatCurrency(Number(value))}
            />
            <YAxis type="number" dataKey="y" name="Overall score" domain={yDomain} />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload || payload.length === 0) {
                  return null
                }
                const point = payload[0]?.payload as PriceScorePoint | undefined
                if (!point) {
                  return null
                }
                return (
                  <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs shadow">
                    <p className="font-semibold text-slate-900">{point.station}</p>
                    <p className="text-slate-700">
                      Median semi: {formatCurrency(point.x)}
                    </p>
                    <p className="text-slate-700">Overall score: {formatNumber(point.y, 1)}</p>
                    <p className="mt-1 text-slate-500">Click the point to keep this area selected.</p>
                  </div>
                )
              }}
            />
            <Scatter
              data={data}
              fill="#0f766e"
              onClick={(event) => {
                const point = (event as { payload?: PriceScorePoint } | undefined)?.payload
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
      {selectedPoint ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Selected area
              </p>
              <p className="font-semibold text-slate-900">{selectedPoint.area.stationName}</p>
            </div>
            <div className="text-right">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Overall score
              </p>
              <p className="font-semibold text-slate-900">
                {formatNumber(selectedPoint.area.dynamicOverallScore, 1)}
              </p>
            </div>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
              <p className="text-[11px] uppercase tracking-wide text-slate-500">Median semi</p>
              <p className="font-semibold text-slate-900">
                {formatCurrency(selectedPoint.area.medianSemiDetachedPrice.value)}
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
              <p className="text-[11px] uppercase tracking-wide text-slate-500">Commute</p>
              <p className="font-semibold text-slate-900">
                {formatNumber(selectedPoint.area.commuteTypicalMinutes.value, 0)} min
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
              <p className="text-[11px] uppercase tracking-wide text-slate-500">Primary score</p>
              <p className="font-semibold text-slate-900">
                {formatNumber(selectedPoint.area.componentScores.schools, 1)}
              </p>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
