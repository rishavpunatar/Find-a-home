import { useMemo } from 'react'
import { useLocation } from 'react-router-dom'

import type { Filters } from '@/types/domain'

import { useSettings } from '@/context/SettingsContext'
import { useRankedData } from '@/hooks/useRankedData'
import {
  DEFAULT_FILTERS,
  FILTER_PRESETS,
  FILTER_PRESET_ORDER,
} from '@/lib/constants'
import { matchesFilters } from '@/lib/filters'

interface RangeControlProps {
  label: string
  value: number
  min: number
  max: number
  step: number
  unit: string
  onChange: (next: number) => void
  disabled?: boolean
  exclusionLabel?: string
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
  exclusionLabel,
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
    {exclusionLabel ? <span className="text-[11px] text-slate-500">{exclusionLabel}</span> : null}
  </label>
)

const filterLabels: Record<keyof Filters, string> = {
  maxCommuteMinutes: 'Commute',
  maxDriveMinutes: 'Pinner drive',
}

const formatFilterValue = (key: keyof Filters, value: number): string => {
  switch (key) {
    case 'maxCommuteMinutes':
    case 'maxDriveMinutes':
      return `${value} min`
    default:
      return value.toString()
  }
}

const excludedLabel = (count: number, total: number): string =>
  `${count.toLocaleString('en-GB')} excluded (${total.toLocaleString('en-GB')} total)`

export const FiltersPanel = () => {
  const location = useLocation()
  const {
    filters,
    londonFilters,
    updateFilter,
    applyFilterPreset,
    resetRankingView,
  } = useSettings()
  const isLondonWideTab = location.pathname === '/trends' || location.pathname === '/ranked-london'
  const scope: 'default' | 'londonWide' = isLondonWideTab ? 'londonWide' : 'default'
  const activeFilters = isLondonWideTab ? londonFilters : filters
  const commuteCap = 60
  const displayedCommuteLimit = isLondonWideTab
    ? Math.min(activeFilters.maxCommuteMinutes, commuteCap)
    : activeFilters.maxCommuteMinutes

  const rankedOptions = isLondonWideTab
    ? ({ scope: 'londonWide', maxCommuteMinutesCap: 70 } as const)
    : ({ scope: 'default' } as const)

  const { ranked, filtered } = useRankedData(rankedOptions)

  const hasCustomFilters = JSON.stringify(activeFilters) !== JSON.stringify(DEFAULT_FILTERS)
  const totalAreaCount = ranked.length

  const exclusionCounts = useMemo(() => {
    const countExcluded = (predicate: (index: number) => boolean) =>
      ranked.reduce((sum, _area, index) => (predicate(index) ? sum : sum + 1), 0)

    return {
      commute: countExcluded(
        (index) =>
          (ranked[index]?.commuteTypicalMinutes.value ?? Number.POSITIVE_INFINITY) <=
          displayedCommuteLimit,
      ),
      drive: countExcluded(
        (index) =>
          (ranked[index]?.driveTimeToPinnerMinutes.value ?? Number.POSITIVE_INFINITY) <=
          activeFilters.maxDriveMinutes,
      ),
    }
  }, [activeFilters.maxDriveMinutes, displayedCommuteLimit, ranked])

  const activeFilterChips = useMemo(
    () =>
      (Object.keys(DEFAULT_FILTERS) as (keyof Filters)[])
        .filter((key) => activeFilters[key] !== DEFAULT_FILTERS[key])
        .map((key) => ({
          key,
          label: filterLabels[key],
          value: activeFilters[key],
          resetValue: DEFAULT_FILTERS[key],
        })),
    [activeFilters],
  )

  const presetCounts = useMemo(
    () =>
      FILTER_PRESET_ORDER.reduce<Record<string, number>>((counts, presetKey) => {
        counts[presetKey] = ranked.filter((area) =>
          matchesFilters(area, FILTER_PRESETS[presetKey].filters),
        ).length
        return counts
      }, {}),
    [ranked],
  )

  return (
    <section className="rounded-2xl border border-teal-100 bg-white p-4 shadow-panel">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
          Filter constraints
        </h2>
        <button
          type="button"
          onClick={() => resetRankingView(scope)}
          disabled={!hasCustomFilters}
          className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Reset view
        </button>
      </div>
      <div className="mb-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
        Showing <span className="font-semibold">{filtered.length}</span> of{' '}
        <span className="font-semibold">{totalAreaCount}</span> ranked micro-areas after the
        active shortlist constraints.
      </div>
      {isLondonWideTab ? (
        <p className="mb-3 text-xs text-slate-600">
          Coverage view is active: commute stays capped at 60 minutes while the broader table
          relaxes the optional Pinner-drive constraint. Use the main Ranked Table when you want
          the stricter shortlist view.
        </p>
      ) : null}

      {!isLondonWideTab ? (
        <div className="mb-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Presets
          </p>
          <div className="flex flex-wrap gap-2">
            {FILTER_PRESET_ORDER.map((presetKey) => (
              <button
                key={presetKey}
                type="button"
                onClick={() => applyFilterPreset(presetKey, scope)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-left text-xs text-slate-700 hover:border-teal-300 hover:bg-teal-50"
                title={FILTER_PRESETS[presetKey].description}
              >
                <span className="block font-semibold">{FILTER_PRESETS[presetKey].label}</span>
                <span className="block text-slate-500">
                  {presetCounts[presetKey]?.toLocaleString('en-GB') ?? 0} matches
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mb-3 flex flex-wrap gap-2">
        {activeFilterChips.length > 0 ? (
          activeFilterChips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              onClick={() => updateFilter(chip.key, chip.resetValue, scope)}
              className="rounded-full border border-teal-200 bg-teal-50 px-3 py-1 text-xs text-slate-700 hover:bg-teal-100"
              title={`Remove ${chip.label} override`}
            >
              {chip.label}: {formatFilterValue(chip.key, chip.value)} ✕
            </button>
          ))
        ) : (
          <p className="text-xs text-slate-500">No active filter overrides.</p>
        )}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <RangeControl
          label="Max commute"
          value={displayedCommuteLimit}
          min={25}
          max={commuteCap}
          step={1}
          unit=" min"
          onChange={(next) => updateFilter('maxCommuteMinutes', next, scope)}
          exclusionLabel={excludedLabel(exclusionCounts.commute, totalAreaCount)}
        />
        <RangeControl
          label="Max drive to Pinner"
          value={activeFilters.maxDriveMinutes}
          min={10}
          max={120}
          step={1}
          unit=" min"
          onChange={(next) => updateFilter('maxDriveMinutes', next, scope)}
          disabled={isLondonWideTab}
          exclusionLabel={
            isLondonWideTab
              ? 'Relaxed in coverage view'
              : excludedLabel(exclusionCounts.drive, totalAreaCount)
          }
        />
      </div>
    </section>
  )
}
