import { useMemo } from 'react'

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

import { formatNumber } from '@/lib/format'
import { summarizeDistribution } from '@/lib/statistics'

type ValueFormatter = (value: number) => string

interface MetricDistributionCardProps {
  title: string
  description: string
  values: number[]
  barColor: string
  valueFormatter?: ValueFormatter
  axisFormatter?: ValueFormatter
}

const defaultFormatter: ValueFormatter = (value) => formatNumber(value, 1)

export const MetricDistributionCard = ({
  title,
  description,
  values,
  barColor,
  valueFormatter = defaultFormatter,
  axisFormatter = defaultFormatter,
}: MetricDistributionCardProps) => {
  const summary = useMemo(() => summarizeDistribution(values), [values])

  if (!summary) {
    return (
      <article className="rounded-2xl border border-teal-100 bg-white p-4 shadow-panel">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-700">{title}</h3>
        <p className="mt-1 text-xs text-slate-500">{description}</p>
        <p className="mt-4 text-sm text-slate-500">No numeric data available yet.</p>
      </article>
    )
  }

  const chartData = summary.bins.map((bin, index) => ({
    key: `${title}-${index}`,
    label:
      bin.start === bin.end
        ? axisFormatter(bin.start)
        : `${axisFormatter(bin.start)} to ${axisFormatter(bin.end)}`,
    count: bin.count,
    start: bin.start,
    end: bin.end,
  }))

  return (
    <article className="rounded-2xl border border-teal-100 bg-white p-4 shadow-panel">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-700">{title}</h3>
      <p className="mt-1 text-xs text-slate-500">{description}</p>

      <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
          <dt className="text-xs uppercase tracking-wide text-slate-500">Mean</dt>
          <dd className="mt-1 font-medium text-slate-900">{valueFormatter(summary.mean)}</dd>
        </div>
        <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
          <dt className="text-xs uppercase tracking-wide text-slate-500">Std dev</dt>
          <dd className="mt-1 font-medium text-slate-900">
            {valueFormatter(summary.standardDeviation)}
          </dd>
        </div>
        <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
          <dt className="text-xs uppercase tracking-wide text-slate-500">Range</dt>
          <dd className="mt-1 font-medium text-slate-900">
            {valueFormatter(summary.min)} to {valueFormatter(summary.max)}
          </dd>
        </div>
        <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
          <dt className="text-xs uppercase tracking-wide text-slate-500">Areas</dt>
          <dd className="mt-1 font-medium text-slate-900">{summary.count}</dd>
        </div>
      </dl>

      <div className="mt-4 h-[240px] w-full">
        <ResponsiveContainer>
          <BarChart data={chartData} margin={{ top: 8, right: 12, bottom: 8, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="label" hide />
            <YAxis allowDecimals={false} width={36} />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload || payload.length === 0) {
                  return null
                }

                const point = payload[0]?.payload as
                  | { count: number; start: number; end: number }
                  | undefined

                if (!point) {
                  return null
                }

                return (
                  <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs shadow">
                    <p className="font-semibold text-slate-900">
                      {point.start === point.end
                        ? valueFormatter(point.start)
                        : `${valueFormatter(point.start)} to ${valueFormatter(point.end)}`}
                    </p>
                    <p className="text-slate-700">Areas: {point.count}</p>
                  </div>
                )
              }}
            />
            <Bar dataKey="count" fill={barColor} radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </article>
  )
}
