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
    <div className="h-72 w-full">
      <ResponsiveContainer>
        <RadarChart data={data}>
          <PolarGrid />
          <PolarAngleAxis dataKey="metric" />
          <PolarRadiusAxis domain={[0, 100]} />
          <Tooltip />
          <Radar dataKey="score" stroke="#0f766e" fill="#0f766e" fillOpacity={0.4} />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  )
}
