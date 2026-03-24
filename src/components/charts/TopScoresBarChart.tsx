import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import type { DerivedMicroArea } from '@/types/domain'

interface TopScoresBarChartProps {
  areas: DerivedMicroArea[]
}

const getColor = (score: number): string => {
  if (score >= 80) {
    return '#059669'
  }

  if (score >= 70) {
    return '#0ea5e9'
  }

  if (score >= 60) {
    return '#f59e0b'
  }

  return '#ef4444'
}

export const TopScoresBarChart = ({ areas }: TopScoresBarChartProps) => {
  const data = areas.slice(0, 20).map((area) => ({
    name: area.stationName,
    score: Number(area.dynamicOverallScore.toFixed(2)),
  }))

  return (
    <div className="h-[420px] w-full">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ left: 0, right: 20, top: 10, bottom: 80 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="name" angle={-45} textAnchor="end" interval={0} height={90} />
          <YAxis domain={[0, 100]} />
          <Tooltip
            content={({ active, payload, label }) => {
              if (!active || !payload || payload.length === 0) {
                return null
              }
              const score = Number(payload[0]?.value ?? 0)
              return (
                <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs shadow">
                  <p className="font-semibold text-slate-900">{String(label)}</p>
                  <p className="text-slate-700">Weighted score: {score.toFixed(2)}</p>
                </div>
              )
            }}
          />
          <Bar dataKey="score" radius={[6, 6, 0, 0]}>
            {data.map((entry) => (
              <Cell key={entry.name} fill={getColor(entry.score)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
