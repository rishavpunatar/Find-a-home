import { useMemo, useState } from 'react'

import { BoroughQolBarChart } from '@/components/charts/BoroughQolBarChart'
import { CommutePm25Scatter } from '@/components/charts/CommutePm25Scatter'
import { DistanceMetricScatter } from '@/components/charts/DistanceMetricScatter'
import { MetricScoreDiagnosticScatter } from '@/components/charts/MetricScoreDiagnosticScatter'
import { OverallConfidenceEvidenceScatter } from '@/components/charts/OverallConfidenceEvidenceScatter'
import { PricePm25ServiceScatter } from '@/components/charts/PricePm25ServiceScatter'
import { SchoolAccessQualityScatter } from '@/components/charts/SchoolAccessQualityScatter'
import { ValueTransportFrontierChart } from '@/components/charts/ValueTransportFrontierChart'
import { ErrorState } from '@/components/ErrorState'
import { LoadingState } from '@/components/LoadingState'
import { RankedTable } from '@/components/table/RankedTable'
import { useDataContext } from '@/context/DataContext'
import { useSettings } from '@/context/SettingsContext'
import { useRankedData } from '@/hooks/useRankedData'
import { shortlistToCsv } from '@/lib/csv'
import { DEFAULT_FILTERS, HIGH_CONFIDENCE_MIN_CONFIDENCE_PCT } from '@/lib/constants'
import {
  crimeDiagnosticScore,
  planningDiagnosticScore,
  proximityDiagnosticScore,
  schoolAccessSubscore,
} from '@/lib/scoringDiagnostics'

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
          These charts are arranged to emphasize the strongest trade-offs in the current dataset,
          then separate those from score-diagnostic views. The aim here is to show how the market
          actually clusters, where the main tensions are, and which score axes are currently
          compressed.
        </p>
        <p className="mt-1 text-xs text-slate-600">
          Tooltips show station names on hover. Switch to high-confidence mode if you want a
          cleaner, lower-noise subset.
        </p>
      </section>

      <section className="rounded-2xl border border-teal-100 bg-white p-4 shadow-panel">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
          Core Trade-Offs
        </h2>
        <p className="mt-2 text-sm text-slate-700">
          These are the clearest decision-shaping relationships in the current London-wide dataset.
        </p>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <article className="rounded-2xl border border-teal-100 bg-white p-4 shadow-panel">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
            Value vs transport frontier
          </h3>
          <p className="mt-2 text-xs text-slate-600">
            Red frontier points are the areas that cannot be improved on both value and transport at
            the same time.
          </p>
          <ValueTransportFrontierChart areas={filtered} />
        </article>
        <article className="rounded-2xl border border-teal-100 bg-white p-4 shadow-panel">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
            Commute vs PM2.5
          </h3>
          <p className="mt-2 text-xs text-slate-600">
            This is one of the strongest structural tensions in the dataset: shorter commutes
            usually come with dirtier air.
          </p>
          <CommutePm25Scatter areas={filtered} />
        </article>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <article className="rounded-2xl border border-teal-100 bg-white p-4 shadow-panel">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
            Price vs PM2.5 sized by peak service
          </h3>
          <p className="mt-2 text-xs text-slate-600">
            Bubble size reflects peak trains per hour, which helps separate expensive-and-well-served
            areas from expensive-but-thinner ones.
          </p>
          <PricePm25ServiceScatter areas={filtered} />
        </article>
        <article className="rounded-2xl border border-teal-100 bg-white p-4 shadow-panel">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
            School access vs school quality
          </h3>
          <p className="mt-2 text-xs text-slate-600">
            This uses raw access counts and raw quality scores rather than the compressed school
            component score.
          </p>
          <SchoolAccessQualityScatter areas={filtered} />
        </article>
      </section>

      <section className="rounded-2xl border border-teal-100 bg-white p-4 shadow-panel">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
          Distance Gradients
        </h2>
        <p className="mt-2 text-sm text-slate-700">
          These show how the wider London station universe changes as you move farther from the
          central destination cluster.
        </p>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <article className="rounded-2xl border border-teal-100 bg-white p-4 shadow-panel">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
            Commute vs distance from central London
          </h3>
          <DistanceMetricScatter
            areas={filtered}
            centralCoordinate={dataset.config.centralLondonCoordinate}
            label="Commute"
            unit=" min"
            formatValue={(value) => `${value.toFixed(1)} min`}
            getValue={(area) => area.commuteTypicalMinutes.value}
          />
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
            formatValue={(value) => `${value.toFixed(1)} ug/m3`}
            getValue={(area) => area.annualPm25.value}
          />
        </article>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <article className="rounded-2xl border border-teal-100 bg-white p-4 shadow-panel">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
            School access vs distance from central London
          </h3>
          <DistanceMetricScatter
            areas={filtered}
            centralCoordinate={dataset.config.centralLondonCoordinate}
            label="School access"
            fill="#7c3aed"
            formatValue={(value) => `${Math.round(value)} schools`}
            getValue={(area) =>
              area.nearbyPrimaryCount.value !== null && area.nearbySecondaryCount.value !== null
                ? area.nearbyPrimaryCount.value + area.nearbySecondaryCount.value
                : null
            }
          />
        </article>
        <article className="rounded-2xl border border-teal-100 bg-white p-4 shadow-panel">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
            Peak service vs distance from central London
          </h3>
          <DistanceMetricScatter
            areas={filtered}
            centralCoordinate={dataset.config.centralLondonCoordinate}
            label="Peak service"
            fill="#0f766e"
            formatValue={(value) => `${value.toFixed(1)} tph`}
            getValue={(area) => area.serviceFrequencyPeakTph.value}
          />
        </article>
      </section>

      <section className="rounded-2xl border border-teal-100 bg-white p-4 shadow-panel">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
          Score Diagnostics
        </h2>
        <p className="mt-2 text-sm text-slate-700">
          These are deliberately diagnostic rather than decision charts. They show where score
          formulas flatten or saturate the raw inputs.
        </p>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <article className="rounded-2xl border border-teal-100 bg-white p-4 shadow-panel">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
            Crime rate vs crime score
          </h3>
          <MetricScoreDiagnosticScatter
            areas={filtered}
            xLabel="Crime rate per 1,000"
            yLabel="Crime score"
            fill="#ef4444"
            formatRawValue={(value) => value.toFixed(1)}
            getRawValue={(area) => area.crimeRatePerThousand.value}
            getScoreValue={(area) =>
              area.crimeRatePerThousand.value === null
                ? null
                : crimeDiagnosticScore(area.crimeRatePerThousand.value)
            }
          />
        </article>
        <article className="rounded-2xl border border-teal-100 bg-white p-4 shadow-panel">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
            Drive to Pinner vs proximity score
          </h3>
          <MetricScoreDiagnosticScatter
            areas={filtered}
            xLabel="Drive to Pinner"
            yLabel="Proximity score"
            fill="#0f766e"
            formatRawValue={(value) => `${value.toFixed(1)} min`}
            getRawValue={(area) => area.driveTimeToPinnerMinutes.value}
            getScoreValue={(area) =>
              area.driveTimeToPinnerMinutes.value === null
                ? null
                : proximityDiagnosticScore(area.driveTimeToPinnerMinutes.value)
            }
          />
        </article>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <article className="rounded-2xl border border-teal-100 bg-white p-4 shadow-panel">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
            Planning risk vs planning score
          </h3>
          <MetricScoreDiagnosticScatter
            areas={filtered}
            xLabel="Planning risk"
            yLabel="Planning score"
            fill="#f59e0b"
            getRawValue={(area) => area.planningRiskHeuristic.value}
            getScoreValue={(area) =>
              area.planningRiskHeuristic.value === null
                ? null
                : planningDiagnosticScore(area.planningRiskHeuristic.value)
            }
          />
        </article>
        <article className="rounded-2xl border border-teal-100 bg-white p-4 shadow-panel">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
            School access vs school access subscore
          </h3>
          <MetricScoreDiagnosticScatter
            areas={filtered}
            xLabel="Total school access"
            yLabel="School access subscore"
            fill="#7c3aed"
            formatRawValue={(value) => `${Math.round(value)} schools`}
            getRawValue={(area) =>
              area.nearbyPrimaryCount.value !== null && area.nearbySecondaryCount.value !== null
                ? area.nearbyPrimaryCount.value + area.nearbySecondaryCount.value
                : null
            }
            getScoreValue={(area) =>
              area.nearbyPrimaryCount.value !== null && area.nearbySecondaryCount.value !== null
                ? schoolAccessSubscore(area.nearbyPrimaryCount.value, area.nearbySecondaryCount.value)
                : null
            }
          />
        </article>
      </section>

      <section className="rounded-2xl border border-teal-100 bg-white p-4 shadow-panel">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
          Trust And Context
        </h2>
        <p className="mt-2 text-sm text-slate-700">
          These charts are less about choosing winners and more about understanding evidence
          quality and the broader borough backdrop.
        </p>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <article className="rounded-2xl border border-teal-100 bg-white p-4 shadow-panel">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
            Overall score vs confidence by property evidence
          </h3>
          <OverallConfidenceEvidenceScatter areas={filtered} />
        </article>
        <article className="rounded-2xl border border-teal-100 bg-white p-4 shadow-panel">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
            Borough QoL by borough
          </h3>
          <BoroughQolBarChart areas={filtered} />
        </article>
      </section>
    </div>
  )
}
