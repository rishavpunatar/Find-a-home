import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
} from 'recharts'

import type { DerivedMicroArea } from '@/types/domain'

interface SubscoreRadarChartProps {
  area: DerivedMicroArea
}

export const SubscoreRadarChart = ({ area }: SubscoreRadarChartProps) => {
  const data = [
    { metric: 'Value', score: area.componentScores.value },
    { metric: 'Transport', score: area.componentScores.transport },
    { metric: 'Schools', score: area.componentScores.schools },
    { metric: 'Environment', score: area.componentScores.environment },
    { metric: 'Crime', score: area.componentScores.crime },
    { metric: 'Pinner', score: area.componentScores.proximity },
    { metric: 'Planning', score: area.componentScores.planningRisk },
  ]

  return (
    <div className="h-[320px] w-full">
      <ResponsiveContainer>
        <RadarChart data={data}>
          <PolarGrid />
          <PolarAngleAxis dataKey="metric" />
          <PolarRadiusAxis domain={[0, 100]} />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload || payload.length === 0) {
                return null
              }
              const point = payload[0] as { payload?: unknown; value?: unknown } | undefined
              const pointPayload = point?.payload
              let metric = ''
              if (
                pointPayload &&
                typeof pointPayload === 'object' &&
                'metric' in pointPayload &&
                typeof (pointPayload as { metric?: unknown }).metric === 'string'
              ) {
                metric = (pointPayload as { metric: string }).metric
              }
              const score = typeof point?.value === 'number' ? point.value : Number(point?.value ?? 0)
              return (
                <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs shadow">
                  <p className="font-semibold text-slate-900">{area.stationName}</p>
                  <p className="text-slate-700">
                    {metric}: {score.toFixed(1)}
                  </p>
                </div>
              )
            }}
          />
          <Radar dataKey="score" stroke="#0f766e" fill="#0f766e" fillOpacity={0.4} />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  )
}
