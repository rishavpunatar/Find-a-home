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

const computeDomain = (values: number[], padRatio = 0.06): [number, number] => {
  if (values.length === 0) {
    return [0, 1]
  }

  const minValue = Math.min(...values)
  const maxValue = Math.max(...values)
  if (minValue === maxValue) {
    const pad = Math.max(1, Math.abs(minValue) * 0.08)
    return [minValue - pad, maxValue + pad]
  }

  const pad = (maxValue - minValue) * padRatio
  return [minValue - pad, maxValue + pad]
}

interface CommutePriceScatterProps {
  areas: DerivedMicroArea[]
}

export const CommutePriceScatter = ({ areas }: CommutePriceScatterProps) => {
  const data = areas
    .filter(
      (area) =>
        area.commuteTypicalMinutes.value !== null && area.medianSemiDetachedPrice.value !== null,
    )
    .map((area) => ({
      x: area.commuteTypicalMinutes.value,
      y: area.medianSemiDetachedPrice.value,
      z: area.dynamicOverallScore,
      station: area.stationName,
    }))
  const xDomain = computeDomain(data.map((item) => Number(item.x)))
  const yDomain = computeDomain(data.map((item) => Number(item.y)))

  return (
    <div className="h-[420px] w-full">
      <ResponsiveContainer>
        <ScatterChart margin={{ top: 12, right: 24, bottom: 26, left: 12 }}>
          <CartesianGrid />
          <XAxis type="number" dataKey="x" name="Commute" unit=" min" domain={xDomain} />
          <YAxis
            type="number"
            dataKey="y"
            name="Median price"
            unit=" GBP"
            width={92}
            domain={yDomain}
          />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload || payload.length === 0) {
                return null
              }
              const point = payload[0]?.payload as
                | { station: string; x: number; y: number; z: number }
                | undefined
              if (!point) {
                return null
              }
              return (
                <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs shadow">
                  <p className="font-semibold text-slate-900">{point.station}</p>
                  <p className="text-slate-700">Commute: {point.x.toFixed(1)} min</p>
                  <p className="text-slate-700">Median semi: GBP {Math.round(point.y).toLocaleString('en-GB')}</p>
                  <p className="text-slate-700">Score: {point.z.toFixed(1)}</p>
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
