import { useMemo, useState } from 'react'

import { CommutePriceScatter } from '@/components/charts/CommutePriceScatter'
import { EnvironmentScatter } from '@/components/charts/EnvironmentScatter'
import { Pm25DistanceScatter } from '@/components/charts/Pm25DistanceScatter'
import { TopScoresBarChart } from '@/components/charts/TopScoresBarChart'
import { ErrorState } from '@/components/ErrorState'
import { LoadingState } from '@/components/LoadingState'
import { RankedTable } from '@/components/table/RankedTable'
import { useDataContext } from '@/context/DataContext'
import { useSettings } from '@/context/SettingsContext'
import { useRankedData } from '@/hooks/useRankedData'
import { shortlistToCsv } from '@/lib/csv'

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
  const { pinnedIds, compareIds, togglePin, toggleCompare, londonFilters } = useSettings()
  const [showTable, setShowTable] = useState(false)
  const { ranked: defaultRanked } = useRankedData()
  const londonWideFilters = useMemo(
    () => ({
      ...londonFilters,
      maxCommuteMinutes: londonFilters.maxCommuteMinutes,
      minSchoolScore: 0,
      maxCrimeRatePerThousand: 10_000,
      maxPm25: 1_000,
      minGreenCoverPct: 0,
      maxMedianPrice: 10_000_000,
    }),
    [londonFilters],
  )
  const { filtered, pinned, effectiveFilters } = useRankedData({
    scope: 'londonWide',
    maxCommuteMinutesCap: LONDON_WIDE_COMMUTE_CAP_MINUTES,
    ignoreMaxDriveMinutes: true,
    overrideFilters: londonWideFilters,
  })
  const { ranked: londonWideRanked } = useRankedData({ scope: 'londonWide' })

  const superScopeRanked = useMemo(() => {
    const byId = new Map<string, (typeof londonWideRanked)[number]>()
    for (const area of londonWideRanked) {
      byId.set(area.microAreaId, area)
    }
    for (const area of defaultRanked) {
      if (!byId.has(area.microAreaId)) {
        byId.set(area.microAreaId, area)
      }
    }
    return [...byId.values()].sort((left, right) => right.dynamicOverallScore - left.dynamicOverallScore)
  }, [defaultRanked, londonWideRanked])
  const brightonExclusion = useMemo(
    () =>
      dataset?.londonWideExcludedByCommute?.find(
        (entry) => entry.stationName.toLowerCase() === 'brighton',
      ) ?? null,
    [dataset],
  )

  if (loading) {
    return <LoadingState title="Building London-wide ranked table" />
  }

  if (error || !dataset) {
    return (
      <ErrorState
        title="London-wide ranked table unavailable"
        detail={error ?? 'Dataset is missing. Run the pipeline and sync processed files.'}
      />
    )
  }

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-teal-100 bg-white p-4 shadow-panel">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
          London-wide commute mode
        </h2>
        <p className="mt-2 text-sm text-slate-700">
          This view enforces a <span className="font-semibold">commute cap up to 60 minutes</span>{' '}
          and intentionally ignores the drive-to-Pinner filter and Pinner-radius candidate prefilter.
        </p>
        <p className="mt-1 text-xs text-slate-600">
          Effective filters in this tab: commute ≤ {effectiveFilters.maxCommuteMinutes} min.
          Candidate generation uses the London-wide scope from all known stations (not the default
          Pinner-focused pipeline search radius). School, crime, PM2.5, green, and price
          constraints are intentionally not limiting results here. Minimum confidence threshold is
          still applied.
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
        <p className="text-sm text-slate-700">
          {filtered.length} micro-areas match London-wide mode. Pin rows, then export your
          shortlist. Use table toggle to focus on charts.
        </p>
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
              downloadCsv('micro-area-shortlist-london-wide.csv', shortlistToCsv(pinned))
            }
            className="rounded-lg bg-surge px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            Export pinned shortlist CSV ({pinned.length})
          </button>
        </div>
      </div>

      {showTable ? (
        <RankedTable
          areas={filtered}
          pinnedIds={pinnedIds}
          compareIds={compareIds}
          onTogglePin={togglePin}
          onToggleCompare={toggleCompare}
        />
      ) : (
        <section className="rounded-2xl border border-teal-100 bg-white p-4 text-sm text-slate-700 shadow-panel">
          London-wide table is hidden. Scroll down to view the full combined-scope charts.
        </section>
      )}

      <section className="rounded-2xl border border-teal-100 bg-white p-4 shadow-panel">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
          Super scope charts (default + London-wide)
        </h2>
        <p className="mt-2 text-sm text-slate-700">
          These charts combine all unique micro-areas from both the default Pinner-focused scope
          and the London-wide scope, so you can inspect the full hundreds-of-points distribution in
          one place.
        </p>
        <p className="mt-1 text-xs text-slate-600">
          Combined unique micro-areas: {superScopeRanked.length}. Tooltips show station names on
          hover.
        </p>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <article className="rounded-2xl border border-teal-100 bg-white p-4 shadow-panel">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
            Top 20 by weighted score (combined scope)
          </h3>
          <TopScoresBarChart areas={superScopeRanked} />
        </article>
        <article className="rounded-2xl border border-teal-100 bg-white p-4 shadow-panel">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
            Commute time vs median semi price (combined scope)
          </h3>
          <CommutePriceScatter areas={superScopeRanked} />
        </article>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <article className="rounded-2xl border border-teal-100 bg-white p-4 shadow-panel">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
            PM2.5 vs green cover (combined scope)
          </h3>
          <EnvironmentScatter areas={superScopeRanked} />
        </article>
      </section>

      <section className="grid gap-4">
        <article className="rounded-2xl border border-teal-100 bg-white p-4 shadow-panel">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
            PM2.5 vs distance from central London (combined scope)
          </h3>
          <Pm25DistanceScatter
            areas={superScopeRanked}
            centralCoordinate={dataset.config.centralLondonCoordinate}
          />
        </article>
      </section>
    </div>
  )
}
