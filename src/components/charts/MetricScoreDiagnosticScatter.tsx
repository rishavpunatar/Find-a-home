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

interface MetricScoreDiagnosticScatterProps {
  areas: DerivedMicroArea[]
  xLabel: string
  yLabel: string
  fill?: string
  getRawValue: (area: DerivedMicroArea) => number | null
  getScoreValue: (area: DerivedMicroArea) => number | null
  formatRawValue?: (value: number) => string
  formatScoreValue?: (value: number) => string
}

export const MetricScoreDiagnosticScatter = ({
  areas,
  xLabel,
  yLabel,
  fill = '#0f766e',
  getRawValue,
  getScoreValue,
  formatRawValue,
  formatScoreValue,
}: MetricScoreDiagnosticScatterProps) => {
  const data = areas
    .map((area) => {
      const rawValue = getRawValue(area)
      const scoreValue = getScoreValue(area)
      if (rawValue === null || scoreValue === null) {
        return null
      }

      return {
        x: rawValue,
        y: scoreValue,
        station: area.stationName,
      }
    })
    .filter((item): item is { x: number; y: number; station: string } => item !== null)

  const xDomain = computeNumericDomain(data.map((item) => item.x), { minFloor: 0 })
  const yDomain = computeNumericDomain(data.map((item) => item.y), { minFloor: 0, maxCeil: 100 })
  const rawFormatter = formatRawValue ?? ((value: number) => value.toFixed(1))
  const scoreFormatter = formatScoreValue ?? ((value: number) => value.toFixed(1))

  return (
    <div className="h-[320px] w-full">
      <ResponsiveContainer>
        <ScatterChart margin={{ top: 12, right: 24, bottom: 26, left: 12 }}>
          <CartesianGrid />
          <XAxis type="number" dataKey="x" name={xLabel} domain={xDomain} />
          <YAxis type="number" dataKey="y" name={yLabel} domain={yDomain} />
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
                  <p className="text-slate-700">
                    {xLabel}: {rawFormatter(point.x)}
                  </p>
                  <p className="text-slate-700">
                    {yLabel}: {scoreFormatter(point.y)}
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
