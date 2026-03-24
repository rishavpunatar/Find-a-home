import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

import type { DerivedMicroArea } from '@/types/domain'

interface ScoreDistributionChartProps {
  areas: DerivedMicroArea[]
}

const buckets = [
  { label: '40-50', min: 40, max: 50 },
  { label: '50-60', min: 50, max: 60 },
  { label: '60-70', min: 60, max: 70 },
  { label: '70-80', min: 70, max: 80 },
  { label: '80-90', min: 80, max: 90 },
]

export const ScoreDistributionChart = ({ areas }: ScoreDistributionChartProps) => {
  const data = buckets.map((bucket) => ({
    label: bucket.label,
    count: areas.filter(
      (area) => area.dynamicOverallScore >= bucket.min && area.dynamicOverallScore < bucket.max,
    ).length,
  }))

  return (
    <div className="h-[360px] w-full">
      <ResponsiveContainer>
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="label" />
          <YAxis allowDecimals={false} />
          <Tooltip
            content={({ active, payload, label }) => {
              if (!active || !payload || payload.length === 0) {
                return null
              }
              const count = Number(payload[0]?.value ?? 0)
              return (
                <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs shadow">
                  <p className="font-semibold text-slate-900">Score bucket {String(label)}</p>
                  <p className="text-slate-700">Micro-areas: {count}</p>
                </div>
              )
            }}
          />
          <Bar dataKey="count" fill="#0f766e" radius={[8, 8, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
