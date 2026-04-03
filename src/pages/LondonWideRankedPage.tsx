import { useMemo, useState } from 'react'

import { DistanceMetricScatter } from '@/components/charts/DistanceMetricScatter'
import { PriceScoreScatter } from '@/components/charts/PriceScoreScatter'
import { ErrorState } from '@/components/ErrorState'
import { LoadingState } from '@/components/LoadingState'
import { RankedTable } from '@/components/table/RankedTable'
import { useDataContext } from '@/context/DataContext'
import { useSettings } from '@/context/SettingsContext'
import { useRankedData } from '@/hooks/useRankedData'
import { shortlistToCsv } from '@/lib/csv'
import { DEFAULT_FILTERS } from '@/lib/constants'
import { formatNumber } from '@/lib/format'
import { schoolAccessPerPopulation } from '@/lib/schoolAccess'

const downloadCsv = (filename: string, data: string) => {
  const blob = new Blob([data], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

const LONDON_WIDE_COMMUTE_CAP_MINUTES = 60

export const LondonWideRankedPage = () => {
  const { dataset, loading, error } = useDataContext()
  const { pinnedIds, togglePin } = useSettings()
  const [showTable, setShowTable] = useState(false)
  const relaxedTrendFilters = useMemo(
    () => ({
      ...DEFAULT_FILTERS,
      maxCommuteMinutes: LONDON_WIDE_COMMUTE_CAP_MINUTES,
      maxDriveMinutes: 180,
    }),
    [],
  )
  const { filtered, pinned, effectiveFilters } = useRankedData({
    scope: 'londonWide',
    maxCommuteMinutesCap: LONDON_WIDE_COMMUTE_CAP_MINUTES,
    ignoreMaxDriveMinutes: true,
    overrideFilters: relaxedTrendFilters,
  })
  const { filtered: filteredViewShortlist } = useRankedData()
  const highlightedAreaIds = useMemo(
    () => filteredViewShortlist.map((area) => area.microAreaId),
    [filteredViewShortlist],
  )
  const brightonExclusion = useMemo(
    () =>
      dataset?.londonWideExcludedByCommute?.find(
        (entry) => entry.stationName.toLowerCase() === 'brighton',
      ) ?? null,
    [dataset],
  )

  if (loading) {
    return <LoadingState title="Building trends view" />
  }

  if (error || !dataset) {
    return (
      <ErrorState
        title="Trends view unavailable"
        detail={error ?? 'Dataset is missing. Run the pipeline and sync processed files.'}
      />
    )
  }

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-teal-100 bg-white p-4 shadow-panel">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
          Trends
        </h2>
        <p className="mt-2 text-sm text-slate-700">
          This page is for understanding how the full commute-defined station universe behaves, not
          for tightening a shortlist. It keeps the{' '}
          <span className="font-semibold">60-minute commute</span> ceiling but otherwise relaxes
          the ranking filters so you can inspect variance, outliers, and broad relationships
          between the ranking axes and supporting context measures.
        </p>
        <p className="mt-1 text-xs text-slate-600">
          Effective scope in this page: commute ≤ {effectiveFilters.maxCommuteMinutes} min.
          The optional Pinner-access constraint is deliberately relaxed here. Use Filtered View
          when you want the stricter shortlist logic.
        </p>
        {dataset.config.londonWideSourceStationCount !== undefined &&
        dataset.config.londonWideExcludedByCommuteCount !== undefined ? (
          <p className="mt-1 text-xs text-slate-600">
            Source stations after dedupe: {dataset.config.londonWideSourceStationCount}. Excluded by
            commute &gt; {LONDON_WIDE_COMMUTE_CAP_MINUTES} minutes:{' '}
            {dataset.config.londonWideExcludedByCommuteCount}.
          </p>
        ) : null}
        {brightonExclusion ? (
          <p className="mt-1 text-xs text-slate-600">
            Brighton is present in source stations but excluded in this tab because estimated
            commute to {dataset.destinationStation} is {brightonExclusion.typicalCommuteMinutes}{' '}
            minutes (&gt; {LONDON_WIDE_COMMUTE_CAP_MINUTES}).
          </p>
        ) : null}
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-teal-100 bg-white p-4 shadow-panel">
        <div>
          <p className="text-sm text-slate-700">
            {filtered.length} micro-areas are currently in the trends universe.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowTable((current) => !current)}
            className="rounded-lg bg-ink px-3 py-2 text-sm font-medium text-white hover:bg-slate-700"
          >
            {showTable ? 'Hide table' : 'Show table'}
          </button>
          <button
            type="button"
            disabled={pinned.length === 0}
            onClick={() =>
              downloadCsv('micro-area-shortlist-trends.csv', shortlistToCsv(pinned))
            }
            className="rounded-lg bg-surge px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            Export pinned CSV ({pinned.length})
          </button>
        </div>
      </div>

      {showTable ? (
        <RankedTable areas={filtered} pinnedIds={pinnedIds} onTogglePin={togglePin} />
      ) : (
        <section className="rounded-2xl border border-teal-100 bg-white p-4 text-sm text-slate-700 shadow-panel">
          Trends table is hidden. Scroll down to focus on the charts.
        </section>
      )}

      <section className="rounded-2xl border border-teal-100 bg-white p-4 shadow-panel">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
          Trend charts
        </h2>
        <p className="mt-2 text-sm text-slate-700">
          These charts focus on the clearest trade-offs and gradients in the current dataset. The
          aim here is to show how the market actually clusters and where the main tensions sit.
        </p>
        <p className="mt-1 text-xs text-slate-600">
          Tooltips show station names on hover. Use the filtered shortlist views when you want a
          tighter decision set rather than a broad trend scan.
        </p>
      </section>

      <section className="rounded-2xl border border-teal-100 bg-white p-4 shadow-panel">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
          Distance Gradients
        </h2>
        <p className="mt-2 text-sm text-slate-700">
          These show how the full commute-defined station universe changes as you move farther from
          the central destination cluster.
        </p>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <article className="rounded-2xl border border-teal-100 bg-white p-4 shadow-panel">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
            Median semi-detached price vs overall score
          </h3>
          <p className="mt-2 text-sm text-slate-700">
            This shows how the current weighted score behaves against raw median semi-detached
            price across the full commute-defined universe.
          </p>
          <PriceScoreScatter areas={filtered} highlightedAreaIds={highlightedAreaIds} />
        </article>
        <article className="rounded-2xl border border-teal-100 bg-white p-4 shadow-panel">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
            PM2.5 vs distance from central London
          </h3>
          <DistanceMetricScatter
            areas={filtered}
            centralCoordinate={dataset.config.centralLondonCoordinate}
            label="PM2.5"
            unit=" ug/m3"
            fill="#0284c7"
            highlightedAreaIds={highlightedAreaIds}
            formatValue={(value) => `${value.toFixed(1)} ug/m3`}
            getValue={(area) => area.annualPm25.value}
          />
        </article>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <article className="rounded-2xl border border-teal-100 bg-white p-4 shadow-panel">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
            Primary-school score vs distance from central London
          </h3>
          <DistanceMetricScatter
            areas={filtered}
            centralCoordinate={dataset.config.centralLondonCoordinate}
            label="Primary-school score"
            fill="#7c3aed"
            highlightFill="#f97316"
            highlightedAreaIds={highlightedAreaIds}
            formatValue={(value) => value.toFixed(1)}
            getValue={(area) => area.componentScores.schools}
            renderSelectedAreaDetail={(area) => {
              const adjustedSchoolAccess =
                area.nearbyPrimaryCount.value !== null
                  ? schoolAccessPerPopulation(
                      area.nearbyPrimaryCount.value,
                      area.populationDenominator ?? null,
                    )
                  : null

              return (
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Selected area
                      </p>
                      <p className="font-semibold text-slate-900">{area.stationName}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Primary-school score
                      </p>
                      <p className="font-semibold text-slate-900">
                        {area.componentScores.schools.toFixed(1)}
                      </p>
                    </div>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                      <p className="text-[11px] uppercase tracking-wide text-slate-500">
                        Primary access per 10,000
                      </p>
                      <p className="font-semibold text-slate-900">
                        {adjustedSchoolAccess === null ? 'N/A' : adjustedSchoolAccess.toFixed(1)}
                      </p>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                      <p className="text-[11px] uppercase tracking-wide text-slate-500">
                        Realistically reachable primary
                      </p>
                      <p className="font-semibold text-slate-900">
                        {formatNumber(area.nearbyPrimaryCount.value, 0)}
                      </p>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                      <p className="text-[11px] uppercase tracking-wide text-slate-500">
                        Primary attainment basket
                      </p>
                      <p className="font-semibold text-slate-900">
                        {formatNumber(area.primaryQualityScore.value, 1)}
                      </p>
                    </div>
                  </div>
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    The current school model is primary-only. Access is admissions-aware rather than
                    a pure 20-minute-drive count, KS2 attainment is smoothed over multiple years,
                    and Ofsted is used only as a warning overlay or modest penalty flag.
                  </div>
                </div>
              )
            }}
          />
        </article>
      </section>
    </div>
  )
}
