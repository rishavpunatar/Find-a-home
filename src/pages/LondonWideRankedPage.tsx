import { useMemo, useState } from 'react'

import { CommutePriceScatter } from '@/components/charts/CommutePriceScatter'
import { EnvironmentScatter } from '@/components/charts/EnvironmentScatter'
import { GreenCoverDistanceScatter } from '@/components/charts/GreenCoverDistanceScatter'
import { QolDistanceScatter } from '@/components/charts/QolDistanceScatter'
import { ErrorState } from '@/components/ErrorState'
import { LoadingState } from '@/components/LoadingState'
import { RankedTable } from '@/components/table/RankedTable'
import { useDataContext } from '@/context/DataContext'
import { useSettings } from '@/context/SettingsContext'
import { useRankedData } from '@/hooks/useRankedData'
import { shortlistToCsv } from '@/lib/csv'
import { DEFAULT_FILTERS, HIGH_CONFIDENCE_MIN_CONFIDENCE_PCT } from '@/lib/constants'

const downloadCsv = (filename: string, data: string) => {
  const blob = new Blob([data], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

const LONDON_WIDE_COMMUTE_CAP_MINUTES = 70

export const LondonWideRankedPage = () => {
  const { dataset, loading, error } = useDataContext()
  const { pinnedIds, togglePin, londonQualityMode, setQualityMode } = useSettings()
  const [showTable, setShowTable] = useState(false)
  const relaxedTrendFilters = useMemo(
    () => ({
      ...DEFAULT_FILTERS,
      maxCommuteMinutes: LONDON_WIDE_COMMUTE_CAP_MINUTES,
      maxDriveMinutes: 180,
      minSchoolScore: 0,
      maxCrimeRatePerThousand: 10_000,
      maxPm25: 1_000,
      minGreenCoverPct: 0,
      maxMedianPrice: 10_000_000,
      minDataConfidencePct: 0,
    }),
    [],
  )
  const { filtered, pinned, effectiveFilters } = useRankedData({
    scope: 'londonWide',
    maxCommuteMinutesCap: LONDON_WIDE_COMMUTE_CAP_MINUTES,
    ignoreMaxDriveMinutes: true,
    overrideFilters: relaxedTrendFilters,
  })
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
          This page is for understanding how the wider London station universe behaves, not for
          tightening a shortlist. It keeps the <span className="font-semibold">70-minute commute</span>{' '}
          ceiling but otherwise relaxes the ranking filters so you can inspect variance, outliers,
          and broad relationships between the metrics.
        </p>
        <p className="mt-1 text-xs text-slate-600">
          Effective scope in this page: commute ≤ {effectiveFilters.maxCommuteMinutes} min.
          School, crime, PM2.5, green cover, price, and Pinner-access constraints are deliberately
          relaxed here. Use Filtered View when you want the stricter shortlist logic.
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
          <p className="mt-1 text-xs text-slate-600">
            High-confidence mode keeps only areas at or above {HIGH_CONFIDENCE_MIN_CONFIDENCE_PCT}%
            confidence.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(['all', 'highConfidence'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setQualityMode(mode, 'londonWide')}
              className={`rounded-full px-3 py-1.5 text-xs font-medium ${
                londonQualityMode === mode
                  ? 'bg-teal-600 text-white'
                  : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              {mode === 'all' ? 'All trend areas' : 'High-confidence only'}
            </button>
          ))}
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
          These charts are meant to show spread and relationships across the broader London
          station-area universe. They are more useful for understanding variance than for picking
          winners directly.
        </p>
        <p className="mt-1 text-xs text-slate-600">
          Tooltips show station names on hover. Switch to high-confidence mode if you want a
          cleaner, lower-noise subset.
        </p>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <article className="rounded-2xl border border-teal-100 bg-white p-4 shadow-panel">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
            Commute time vs median semi price
          </h3>
          <CommutePriceScatter areas={filtered} />
        </article>
        <article className="rounded-2xl border border-teal-100 bg-white p-4 shadow-panel">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
            Green cover vs PM2.5
          </h3>
          <EnvironmentScatter areas={filtered} />
        </article>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <article className="rounded-2xl border border-teal-100 bg-white p-4 shadow-panel">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
            Green cover vs distance from central London
          </h3>
          <GreenCoverDistanceScatter
            areas={filtered}
            centralCoordinate={dataset.config.centralLondonCoordinate}
          />
        </article>
        <article className="rounded-2xl border border-teal-100 bg-white p-4 shadow-panel">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
            Borough QoL vs distance from central London
          </h3>
          <QolDistanceScatter
            areas={filtered}
            centralCoordinate={dataset.config.centralLondonCoordinate}
          />
        </article>
      </section>
    </div>
  )
}
