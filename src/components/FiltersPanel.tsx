import { useMemo } from 'react'
import { useLocation } from 'react-router-dom'

import type { Filters, QualityMode } from '@/types/domain'

import { useSettings } from '@/context/SettingsContext'
import { useRankedData } from '@/hooks/useRankedData'
import {
  DEFAULT_FILTERS,
  DEFAULT_QUALITY_MODE,
  FILTER_PRESETS,
  FILTER_PRESET_ORDER,
  HIGH_CONFIDENCE_MIN_CONFIDENCE_PCT,
} from '@/lib/constants'
import { isHighConfidenceArea } from '@/lib/dataQuality'
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
  maxDriveMinutes: 'Drive to Pinner',
  minSchoolScore: 'School score',
  maxCrimeRatePerThousand: 'Crime',
  maxPm25: 'PM2.5',
  minGreenCoverPct: 'Green cover',
  maxMedianPrice: 'Median semi price',
  minDataConfidencePct: 'Confidence',
}

const formatFilterValue = (key: keyof Filters, value: number): string => {
  switch (key) {
    case 'maxCommuteMinutes':
    case 'maxDriveMinutes':
      return `${value} min`
    case 'maxCrimeRatePerThousand':
      return `${value} / 1,000`
    case 'maxPm25':
      return `${value.toFixed(1)} ug/m3`
    case 'minGreenCoverPct':
    case 'minDataConfidencePct':
      return `${value}%`
    case 'maxMedianPrice':
      return `GBP ${value.toLocaleString('en-GB')}`
    default:
      return value.toString()
  }
}

const excludedLabel = (count: number, total: number): string =>
  `${count.toLocaleString('en-GB')} excluded (${total.toLocaleString('en-GB')} total)`

const qualityModeLabel: Record<QualityMode, string> = {
  all: 'All ranked areas',
  highConfidence: 'High-confidence only',
}

export const FiltersPanel = () => {
  const location = useLocation()
  const {
    filters,
    londonFilters,
    qualityMode,
    londonQualityMode,
    updateFilter,
    applyFilterPreset,
    resetRankingView,
    setQualityMode,
  } = useSettings()
  const isLondonWideTab = location.pathname === '/ranked-london'
  const scope: 'default' | 'londonWide' = isLondonWideTab ? 'londonWide' : 'default'
  const activeFilters = isLondonWideTab ? londonFilters : filters
  const activeQualityMode = isLondonWideTab ? londonQualityMode : qualityMode
  const commuteCap = isLondonWideTab ? 60 : 70
  const displayedCommuteLimit = isLondonWideTab
    ? Math.min(activeFilters.maxCommuteMinutes, commuteCap)
    : activeFilters.maxCommuteMinutes

  const rankedOptions = isLondonWideTab
    ? ({ scope: 'londonWide', maxCommuteMinutesCap: 60 } as const)
    : ({ scope: 'default' } as const)

  const { ranked, filtered } = useRankedData(rankedOptions)

  const hasCustomFilters =
    JSON.stringify(activeFilters) !== JSON.stringify(DEFAULT_FILTERS) ||
    activeQualityMode !== DEFAULT_QUALITY_MODE
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
      school: countExcluded((index) => (ranked[index]?.componentScores.schools ?? 0) >= activeFilters.minSchoolScore),
      crime: countExcluded(
        (index) =>
          (ranked[index]?.crimeRatePerThousand.value ?? Number.POSITIVE_INFINITY) <=
          activeFilters.maxCrimeRatePerThousand,
      ),
      pm25: countExcluded(
        (index) =>
          (ranked[index]?.annualPm25.value ?? Number.POSITIVE_INFINITY) <= activeFilters.maxPm25,
      ),
      green: countExcluded(
        (index) => (ranked[index]?.greenCoverPct.value ?? Number.NEGATIVE_INFINITY) >= activeFilters.minGreenCoverPct,
      ),
      price: countExcluded(
        (index) =>
          (ranked[index]?.medianSemiDetachedPrice.value ?? Number.POSITIVE_INFINITY) <=
          activeFilters.maxMedianPrice,
      ),
      confidence: countExcluded(
        (index) =>
          ((ranked[index]?.dataConfidenceScore ?? 0) * 100) >= activeFilters.minDataConfidencePct,
      ),
    }
  }, [
    activeFilters.maxCrimeRatePerThousand,
    activeFilters.maxDriveMinutes,
    activeFilters.maxMedianPrice,
    activeFilters.maxPm25,
    activeFilters.minDataConfidencePct,
    activeFilters.minGreenCoverPct,
    activeFilters.minSchoolScore,
    displayedCommuteLimit,
    ranked,
  ])

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
        const baseCount = ranked.filter((area) => matchesFilters(area, FILTER_PRESETS[presetKey].filters))
        counts[presetKey] =
          activeQualityMode === 'highConfidence'
            ? baseCount.filter((area) => isHighConfidenceArea(area)).length
            : baseCount.length
        return counts
      }, {}),
    [activeQualityMode, ranked],
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
        <span className="font-semibold">{totalAreaCount}</span> ranked micro-areas in{' '}
        <span className="font-semibold">{qualityModeLabel[activeQualityMode]}</span> mode.
      </div>
      {isLondonWideTab ? (
        <p className="mb-3 text-xs text-slate-600">
          London {'<=60m'} mode is active: only commute is applied here. Drive-to-Pinner, school,
          crime, PM2.5, green-cover, and price filters are ignored in this tab, and candidates are
          not prefiltered by the Pinner search radius. Confidence filter still applies.
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

      <div className="mb-3">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Trust mode
        </p>
        <div className="flex flex-wrap gap-2">
          {(['all', 'highConfidence'] as QualityMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setQualityMode(mode, scope)}
              className={`rounded-full px-3 py-1.5 text-xs font-medium ${
                activeQualityMode === mode
                  ? 'bg-teal-600 text-white'
                  : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              {qualityModeLabel[mode]}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-slate-600">
          High-confidence mode keeps only areas at or above {HIGH_CONFIDENCE_MIN_CONFIDENCE_PCT}%
          confidence. Use it when you want a cleaner shortlist rather than maximum coverage.
        </p>
      </div>

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
        {activeQualityMode !== DEFAULT_QUALITY_MODE ? (
          <button
            type="button"
            onClick={() => setQualityMode(DEFAULT_QUALITY_MODE, scope)}
            className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs text-amber-900 hover:bg-amber-100"
          >
            Trust mode: {qualityModeLabel[activeQualityMode]} ✕
          </button>
        ) : null}
      </div>

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
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
          max={80}
          step={1}
          unit=" min"
          onChange={(next) => updateFilter('maxDriveMinutes', next, scope)}
          disabled={isLondonWideTab}
          exclusionLabel={
            isLondonWideTab
              ? 'Ignored in London <=60m mode'
              : excludedLabel(exclusionCounts.drive, totalAreaCount)
          }
        />
        <RangeControl
          label="Min school score"
          value={activeFilters.minSchoolScore}
          min={0}
          max={100}
          step={1}
          unit=""
          onChange={(next) => updateFilter('minSchoolScore', next, scope)}
          disabled={isLondonWideTab}
          exclusionLabel={
            isLondonWideTab
              ? 'Ignored in London <=60m mode'
              : excludedLabel(exclusionCounts.school, totalAreaCount)
          }
        />
        <RangeControl
          label="Max crime / 1,000"
          value={activeFilters.maxCrimeRatePerThousand}
          min={20}
          max={160}
          step={1}
          unit=""
          onChange={(next) => updateFilter('maxCrimeRatePerThousand', next, scope)}
          disabled={isLondonWideTab}
          exclusionLabel={
            isLondonWideTab
              ? 'Ignored in London <=60m mode'
              : excludedLabel(exclusionCounts.crime, totalAreaCount)
          }
        />
        <RangeControl
          label="Max PM2.5"
          value={activeFilters.maxPm25}
          min={5}
          max={20}
          step={0.1}
          unit=" ug/m3"
          onChange={(next) => updateFilter('maxPm25', next, scope)}
          disabled={isLondonWideTab}
          exclusionLabel={
            isLondonWideTab
              ? 'Ignored in London <=60m mode'
              : excludedLabel(exclusionCounts.pm25, totalAreaCount)
          }
        />
        <RangeControl
          label="Min green cover"
          value={activeFilters.minGreenCoverPct}
          min={0}
          max={80}
          step={1}
          unit="%"
          onChange={(next) => updateFilter('minGreenCoverPct', next, scope)}
          disabled={isLondonWideTab}
          exclusionLabel={
            isLondonWideTab
              ? 'Ignored in London <=60m mode'
              : excludedLabel(exclusionCounts.green, totalAreaCount)
          }
        />
        <RangeControl
          label="Max median semi price"
          value={activeFilters.maxMedianPrice}
          min={300000}
          max={2000000}
          step={10000}
          unit=" GBP"
          onChange={(next) => updateFilter('maxMedianPrice', next, scope)}
          disabled={isLondonWideTab}
          exclusionLabel={
            isLondonWideTab
              ? 'Ignored in London <=60m mode'
              : excludedLabel(exclusionCounts.price, totalAreaCount)
          }
        />
        <RangeControl
          label="Min confidence"
          value={activeFilters.minDataConfidencePct}
          min={0}
          max={100}
          step={1}
          unit="%"
          onChange={(next) => updateFilter('minDataConfidencePct', next, scope)}
          exclusionLabel={excludedLabel(exclusionCounts.confidence, totalAreaCount)}
        />
      </div>
    </section>
  )
}
