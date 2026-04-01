import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import type { DerivedMicroArea } from '@/types/domain'

import { computeNumericDomain } from './chartUtils'

interface BoroughQolBarChartProps {
  areas: DerivedMicroArea[]
}

export const BoroughQolBarChart = ({ areas }: BoroughQolBarChartProps) => {
  const grouped = new Map<string, { authority: string; values: number[]; areaCount: number }>()

  for (const area of areas) {
    if (area.boroughQolScore.value === null) {
      continue
    }

    const key = area.boroughQolAuthority
    const current = grouped.get(key) ?? { authority: key, values: [], areaCount: 0 }
    current.values.push(area.boroughQolScore.value)
    current.areaCount += 1
    grouped.set(key, current)
  }

  const data = [...grouped.values()]
    .map((entry) => ({
      authority: entry.authority,
      qol: entry.values.reduce((sum, value) => sum + value, 0) / entry.values.length,
      areaCount: entry.areaCount,
    }))
    .sort((left, right) => right.qol - left.qol)

  const xDomain = computeNumericDomain(data.map((item) => item.qol), { minFloor: 0, maxCeil: 100 })

  return (
    <div className="h-[720px] w-full">
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ top: 12, right: 24, bottom: 12, left: 72 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis type="number" domain={xDomain} />
          <YAxis type="category" dataKey="authority" width={132} interval={0} />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload || payload.length === 0) {
                return null
              }
              const point = payload[0]?.payload as
                | { authority: string; qol: number; areaCount: number }
                | undefined
              if (!point) {
                return null
              }
              return (
                <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs shadow">
                  <p className="font-semibold text-slate-900">{point.authority}</p>
                  <p className="text-slate-700">QoL score: {point.qol.toFixed(1)}</p>
                  <p className="text-slate-700">Areas in current view: {point.areaCount}</p>
                </div>
              )
            }}
          />
          <Bar dataKey="qol" fill="#0284c7" radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
