import type { Weights } from '@/types/domain'

import { useSettings } from '@/context/SettingsContext'
import { weightsSum } from '@/lib/weights'

interface SettingsPanelProps {
  onClose: () => void
}

const labelMap: Record<keyof Weights, string> = {
  transport: 'Transport / commute',
  schools: 'Schools',
  environment: 'Environment',
  crime: 'Crime / safety',
}

export const SettingsPanel = ({ onClose }: SettingsPanelProps) => {
  const {
    activeWeights,
    normalizedWeights,
    weightingMode,
    updateWeight,
    resetWeights,
    setWeightingMode,
  } = useSettings()

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
      <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
        <p className="font-semibold uppercase tracking-wide text-slate-600">Weighting mode</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setWeightingMode('manual')}
            className={`rounded-full px-3 py-1.5 font-medium ${
              weightingMode === 'manual'
                ? 'bg-teal-600 text-white'
                : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            Manual
          </button>
          <button
            type="button"
            onClick={() => setWeightingMode('varianceAwareDefaults')}
            className={`rounded-full px-3 py-1.5 font-medium ${
              weightingMode === 'varianceAwareDefaults'
                ? 'bg-teal-600 text-white'
                : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            Spread-aware defaults
          </button>
        </div>
        <p className="mt-2">
          Spread-aware defaults use robust spread across the full dataset plus confidence penalties
          to slightly rebalance the default mix. If you move any slider, control returns to manual.
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {(Object.keys(activeWeights) as (keyof Weights)[]).map((key) => (
          <label key={key} className="flex flex-col gap-1">
            <span className="text-xs font-medium text-slate-600">
              {labelMap[key]}: active {activeWeights[key].toFixed(1)} | normalized{' '}
              {normalizedWeights[key].toFixed(1)}%
            </span>
            <input
              type="range"
              min={0}
              max={100}
              step={0.5}
              value={activeWeights[key]}
              onChange={(event) => updateWeight(key, Number(event.currentTarget.value))}
              className="h-2 w-full cursor-pointer rounded-lg bg-teal-100"
              aria-label={`Weight for ${labelMap[key]}`}
            />
          </label>
        ))}
      </div>
      <p className="mt-3 text-xs text-slate-600">
        Normalized weights sum to {weightsSum(normalizedWeights).toFixed(1)}%. If sliders do not sum
        to 100, normalization is applied automatically.
      </p>
    </section>
  )
}
