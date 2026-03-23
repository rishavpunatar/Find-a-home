import { useLocation } from 'react-router-dom'

import { useSettings } from '@/context/SettingsContext'
import { DEFAULT_FILTERS } from '@/lib/constants'

interface RangeControlProps {
  label: string
  value: number
  min: number
  max: number
  step: number
  unit: string
  onChange: (next: number) => void
  disabled?: boolean
}

const RangeControl = ({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
  disabled = false,
}: RangeControlProps) => (
  <label className={`flex flex-col gap-1 ${disabled ? 'opacity-60' : ''}`}>
    <span className="text-xs font-medium text-slate-600">
      {label}:{' '}
      <span className="font-semibold text-slate-800">{value.toLocaleString('en-GB') + unit}</span>
    </span>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(event) => onChange(Number(event.currentTarget.value))}
      disabled={disabled}
      className="h-2 w-full cursor-pointer rounded-lg bg-teal-100"
      aria-label={label}
    />
  </label>
)

export const FiltersPanel = () => {
  const location = useLocation()
  const { filters, updateFilter, resetFilters } = useSettings()
  const isLondonWideTab = location.pathname === '/ranked-london'
  const commuteCap = isLondonWideTab ? 60 : 70
  const displayedCommuteLimit = isLondonWideTab
    ? Math.min(filters.maxCommuteMinutes, commuteCap)
    : filters.maxCommuteMinutes

  const hasCustomFilters = JSON.stringify(filters) !== JSON.stringify(DEFAULT_FILTERS)

  return (
    <section className="rounded-2xl border border-teal-100 bg-white p-4 shadow-panel">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
          Filter constraints
        </h2>
        <button
          type="button"
          onClick={resetFilters}
          disabled={!hasCustomFilters}
          className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Reset
        </button>
      </div>
      {isLondonWideTab ? (
        <p className="mb-3 text-xs text-slate-600">
          London ≤60m mode is active: commute is capped at 60 minutes and drive-to-Pinner is not
          applied in this tab.
        </p>
      ) : null}
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        <RangeControl
          label="Max commute"
          value={displayedCommuteLimit}
          min={25}
          max={commuteCap}
          step={1}
          unit=" min"
          onChange={(next) => updateFilter('maxCommuteMinutes', next)}
        />
        <RangeControl
          label="Max drive to Pinner"
          value={filters.maxDriveMinutes}
          min={10}
          max={35}
          step={1}
          unit=" min"
          onChange={(next) => updateFilter('maxDriveMinutes', next)}
          disabled={isLondonWideTab}
        />
        <RangeControl
          label="Min school score"
          value={filters.minSchoolScore}
          min={0}
          max={100}
          step={1}
          unit=""
          onChange={(next) => updateFilter('minSchoolScore', next)}
        />
        <RangeControl
          label="Max crime / 1,000"
          value={filters.maxCrimeRatePerThousand}
          min={20}
          max={140}
          step={1}
          unit=""
          onChange={(next) => updateFilter('maxCrimeRatePerThousand', next)}
        />
        <RangeControl
          label="Max NO2"
          value={filters.maxNo2}
          min={10}
          max={40}
          step={0.5}
          unit=" ug/m3"
          onChange={(next) => updateFilter('maxNo2', next)}
        />
        <RangeControl
          label="Min green cover"
          value={filters.minGreenCoverPct}
          min={5}
          max={80}
          step={1}
          unit="%"
          onChange={(next) => updateFilter('minGreenCoverPct', next)}
        />
        <RangeControl
          label="Max median semi price"
          value={filters.maxMedianPrice}
          min={300000}
          max={1500000}
          step={10000}
          unit=" GBP"
          onChange={(next) => updateFilter('maxMedianPrice', next)}
        />
      </div>
    </section>
  )
}
