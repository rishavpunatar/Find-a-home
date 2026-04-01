import {
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import type { DerivedMicroArea } from '@/types/domain'

import { computeNumericDomain } from './chartUtils'

interface ValueTransportFrontierChartProps {
  areas: DerivedMicroArea[]
}

interface FrontierPoint {
  x: number
  y: number
  station: string
  overall: number
}

const buildParetoFrontier = (points: FrontierPoint[]): FrontierPoint[] => {
  const sorted = [...points].sort((left, right) => right.x - left.x || right.y - left.y)
  const frontier: FrontierPoint[] = []
  let bestTransport = Number.NEGATIVE_INFINITY

  for (const point of sorted) {
    if (point.y > bestTransport) {
      frontier.push(point)
      bestTransport = point.y
    }
  }

  return frontier.sort((left, right) => left.x - right.x)
}

export const ValueTransportFrontierChart = ({ areas }: ValueTransportFrontierChartProps) => {
  const data = areas.map((area) => ({
    x: area.componentScores.value,
    y: area.componentScores.transport,
    station: area.stationName,
    overall: area.dynamicOverallScore,
  }))
  const frontier = buildParetoFrontier(data)
  const xDomain = computeNumericDomain(data.map((item) => item.x), { minFloor: 0, maxCeil: 100 })
  const yDomain = computeNumericDomain(data.map((item) => item.y), { minFloor: 0, maxCeil: 100 })

  return (
    <div className="h-[420px] w-full">
      <ResponsiveContainer>
        <ComposedChart margin={{ top: 12, right: 24, bottom: 26, left: 12 }}>
          <CartesianGrid />
          <XAxis type="number" dataKey="x" name="Value score" domain={xDomain} />
          <YAxis type="number" dataKey="y" name="Transport score" domain={yDomain} />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload || payload.length === 0) {
                return null
              }
              const point = payload.find((entry) => entry.payload)?.payload as FrontierPoint | undefined
              if (!point) {
                return null
              }
              return (
                <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs shadow">
                  <p className="font-semibold text-slate-900">{point.station}</p>
                  <p className="text-slate-700">Value score: {point.x.toFixed(1)}</p>
                  <p className="text-slate-700">Transport score: {point.y.toFixed(1)}</p>
                  <p className="text-slate-700">Overall score: {point.overall.toFixed(1)}</p>
                </div>
              )
            }}
          />
          <Legend />
          <Scatter name="All areas" data={data} fill="#0f766e" />
          <Line
            name="Pareto frontier"
            data={frontier}
            dataKey="y"
            stroke="#b91c1c"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
          <Scatter name="Frontier areas" data={frontier} fill="#b91c1c" />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
