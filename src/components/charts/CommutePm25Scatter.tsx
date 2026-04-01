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

import { computeNumericDomain } from './chartUtils'

interface CommutePm25ScatterProps {
  areas: DerivedMicroArea[]
}

export const CommutePm25Scatter = ({ areas }: CommutePm25ScatterProps) => {
  const data = areas
    .filter((area) => area.commuteTypicalMinutes.value !== null && area.annualPm25.value !== null)
    .map((area) => ({
      x: area.commuteTypicalMinutes.value,
      y: area.annualPm25.value,
      station: area.stationName,
      medianPrice: area.medianSemiDetachedPrice.value,
    }))

  const xDomain = computeNumericDomain(data.map((item) => Number(item.x)), { minFloor: 0 })
  const yDomain = computeNumericDomain(data.map((item) => Number(item.y)), { minFloor: 0 })

  return (
    <div className="h-[420px] w-full">
      <ResponsiveContainer>
        <ScatterChart margin={{ top: 12, right: 24, bottom: 26, left: 12 }}>
          <CartesianGrid />
          <XAxis type="number" dataKey="x" name="Commute" unit=" min" domain={xDomain} />
          <YAxis type="number" dataKey="y" name="PM2.5" unit=" ug/m3" domain={yDomain} />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload || payload.length === 0) {
                return null
              }
              const point = payload[0]?.payload as
                | { station: string; x: number; y: number; medianPrice: number | null }
                | undefined
              if (!point) {
                return null
              }
              return (
                <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs shadow">
                  <p className="font-semibold text-slate-900">{point.station}</p>
                  <p className="text-slate-700">Commute: {point.x.toFixed(1)} min</p>
                  <p className="text-slate-700">PM2.5: {point.y.toFixed(1)} ug/m3</p>
                  {point.medianPrice !== null ? (
                    <p className="text-slate-700">
                      Median semi: GBP {Math.round(point.medianPrice).toLocaleString('en-GB')}
                    </p>
                  ) : null}
                </div>
              )
            }}
          />
          <Scatter data={data} fill="#0284c7" />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  )
}
