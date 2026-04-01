import {
  CartesianGrid,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts'

import type { DerivedMicroArea } from '@/types/domain'

import { computeNumericDomain } from './chartUtils'

interface PricePm25ServiceScatterProps {
  areas: DerivedMicroArea[]
}

export const PricePm25ServiceScatter = ({ areas }: PricePm25ServiceScatterProps) => {
  const data = areas
    .filter(
      (area) =>
        area.medianSemiDetachedPrice.value !== null &&
        area.annualPm25.value !== null &&
        area.serviceFrequencyPeakTph.value !== null,
    )
    .map((area) => ({
      x: area.medianSemiDetachedPrice.value,
      y: area.annualPm25.value,
      z: area.serviceFrequencyPeakTph.value,
      station: area.stationName,
      commute: area.commuteTypicalMinutes.value,
    }))

  const xDomain = computeNumericDomain(data.map((item) => Number(item.x)), { minFloor: 0 })
  const yDomain = computeNumericDomain(data.map((item) => Number(item.y)), { minFloor: 0 })

  return (
    <div className="h-[420px] w-full">
      <ResponsiveContainer>
        <ScatterChart margin={{ top: 12, right: 24, bottom: 26, left: 12 }}>
          <CartesianGrid />
          <XAxis type="number" dataKey="x" name="Median price" unit=" GBP" domain={xDomain} />
          <YAxis type="number" dataKey="y" name="PM2.5" unit=" ug/m3" domain={yDomain} />
          <ZAxis type="number" dataKey="z" name="Peak tph" range={[48, 280]} />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload || payload.length === 0) {
                return null
              }
              const point = payload[0]?.payload as
                | { station: string; x: number; y: number; z: number; commute: number | null }
                | undefined
              if (!point) {
                return null
              }
              return (
                <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs shadow">
                  <p className="font-semibold text-slate-900">{point.station}</p>
                  <p className="text-slate-700">
                    Median semi: GBP {Math.round(point.x).toLocaleString('en-GB')}
                  </p>
                  <p className="text-slate-700">PM2.5: {point.y.toFixed(1)} ug/m3</p>
                  <p className="text-slate-700">Peak service: {point.z.toFixed(1)} tph</p>
                  {point.commute !== null ? (
                    <p className="text-slate-700">Commute: {point.commute.toFixed(1)} min</p>
                  ) : null}
                </div>
              )
            }}
          />
          <Scatter data={data} fill="#0f766e" />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  )
}
