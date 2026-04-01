import type { Weights } from '@/types/domain'

import { useSettings } from '@/context/SettingsContext'
import { weightsSum } from '@/lib/weights'

interface SettingsPanelProps {
  onClose: () => void
}

const labelMap: Record<keyof Weights, string> = {
  value: 'Value for money',
  transport: 'Transport / commute',
  schools: 'Schools',
  environment: 'Environment',
  crime: 'Crime / safety',
  proximity: 'Pinner access (optional)',
  planningRisk: 'Planning risk',
}

export const SettingsPanel = ({ onClose }: SettingsPanelProps) => {
  const { rawWeights, normalizedWeights, updateWeight, resetWeights } = useSettings()

  return (
    <section className="rounded-2xl border border-teal-100 bg-white p-4 shadow-panel">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
          Scoring weights
        </h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={resetWeights}
            className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700"
          >
            Defaults
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700"
          >
            Close
          </button>
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {(Object.keys(rawWeights) as (keyof Weights)[]).map((key) => (
          <label key={key} className="flex flex-col gap-1">
            <span className="text-xs font-medium text-slate-600">
              {labelMap[key]}: raw {rawWeights[key].toFixed(1)} | normalized{' '}
              {normalizedWeights[key].toFixed(1)}%
            </span>
            <input
              type="range"
              min={0}
              max={100}
              step={0.5}
              value={rawWeights[key]}
              onChange={(event) => updateWeight(key, Number(event.currentTarget.value))}
              className="h-2 w-full cursor-pointer rounded-lg bg-teal-100"
              aria-label={`Weight for ${labelMap[key]}`}
            />
          </label>
        ))}
      </div>
      <p className="mt-3 text-xs text-slate-600">
        Normalized weights sum to {weightsSum(normalizedWeights).toFixed(1)}%. If raw sliders do not
        sum to 100, normalization is applied automatically.
      </p>
    </section>
  )
}
