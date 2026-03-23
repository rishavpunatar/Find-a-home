import { useState } from 'react'

import { ErrorState } from '@/components/ErrorState'
import { LoadingState } from '@/components/LoadingState'
import { type ColorMetric, MicroAreaMap } from '@/components/map/MicroAreaMap'
import { useDataContext } from '@/context/DataContext'
import { useRankedData } from '@/hooks/useRankedData'

const metricOptions: Array<{ value: ColorMetric; label: string }> = [
  { value: 'overall', label: 'Overall score' },
  { value: 'value', label: 'Value for money' },
  { value: 'transport', label: 'Transport' },
  { value: 'schools', label: 'Schools' },
  { value: 'environment', label: 'Environment' },
  { value: 'crime', label: 'Crime' },
  { value: 'proximity', label: 'Pinner proximity' },
  { value: 'planningRisk', label: 'Planning risk' },
]

export const MapPage = () => {
  const { loading, error } = useDataContext()
  const { filtered } = useRankedData()
  const [metric, setMetric] = useState<ColorMetric>('overall')

  if (loading) {
    return <LoadingState title="Loading map layer" />
  }

  if (error) {
    return <ErrorState title="Map unavailable" detail={error} />
  }

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-teal-100 bg-white p-4 shadow-panel">
        <label className="text-sm font-medium text-slate-700" htmlFor="mapMetric">
          Colour micro-areas by metric
        </label>
        <select
          id="mapMetric"
          value={metric}
          onChange={(event) => setMetric(event.currentTarget.value as ColorMetric)}
          className="mt-2 w-full rounded-lg border-slate-300 text-sm md:w-80"
        >
          {metricOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </section>

      <MicroAreaMap areas={filtered} metric={metric} />
    </div>
  )
}
