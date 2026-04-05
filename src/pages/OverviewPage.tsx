import { Link, useLocation } from 'react-router-dom'

import { AreaTrustSummary } from '@/components/AreaTrustSummary'
import { CommutePriceScatter } from '@/components/charts/CommutePriceScatter'
import { EnvironmentScatter } from '@/components/charts/EnvironmentScatter'
import { MetricDistributionCard } from '@/components/charts/MetricDistributionCard'
import { Pm25DistanceScatter } from '@/components/charts/Pm25DistanceScatter'
import { QolDistanceScatter } from '@/components/charts/QolDistanceScatter'
import { TopScoresBarChart } from '@/components/charts/TopScoresBarChart'
import { ErrorState } from '@/components/ErrorState'
import { LoadingState } from '@/components/LoadingState'
import { useDataContext } from '@/context/DataContext'
import { useRankedData } from '@/hooks/useRankedData'
import { isHighConfidenceArea, summarizeDatasetDomainCoverage } from '@/lib/dataQuality'
import { formatDate } from '@/lib/format'
import { rankingAxes } from '@/lib/rankingAxes'

const coverageLabelMap = {
  property: 'Property',
  transport: 'Transport',
  schools: 'Schools',
  pollution: 'Pollution',
  greenSpace: 'Green',
  crime: 'Crime',
  roads: 'Main roads',
  wellbeing: 'QoL context',
} as const

const StatCard = ({ label, value, hint }: { label: string; value: string; hint?: string }) => (
  <article className="rounded-2xl border border-teal-100 bg-white p-4 shadow-panel">
    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
    <p className="mt-1 text-2xl font-semibold text-slate-900">{value}</p>
    {hint ? <p className="mt-1 text-xs text-slate-600">{hint}</p> : null}
  </article>
)

export const OverviewPage = () => {
  const location = useLocation()
  const { dataset, loading, error } = useDataContext()
  const { ranked, filtered } = useRankedData()
  const fromPath = `${location.pathname}${location.search}`

  if (loading) {
    return <LoadingState title="Loading precomputed micro-area dataset" />
  }

  if (error || !dataset) {
    return (
      <ErrorState
        title="Could not load micro-area dataset"
        detail={error ?? 'Dataset is missing. Run the pipeline and sync processed files.'}
      />
    )
  }

  const topFive = filtered.slice(0, 5)
  const londonWideCount = dataset.londonWideMicroAreas?.length ?? ranked.length
  const highConfidenceCount = ranked.filter((area) => isHighConfidenceArea(area)).length
  const domainCoverage = summarizeDatasetDomainCoverage(dataset.microAreas)
  const averageScore = filtered.length
    ? (filtered.reduce((sum, area) => sum + area.dynamicOverallScore, 0) / filtered.length).toFixed(
        1,
      )
    : '0.0'
  const scoreDistributions = [
    {
      key: 'overall-weighted-score',
      title: 'Overall weighted score',
      description: 'All default-scope areas using your active weighting model.',
      values: ranked.map((area) => area.dynamicOverallScore),
      barColor: '#0f766e',
    },
    ...rankingAxes.map((axis) => ({
      key: `${axis.key}-score`,
      title: axis.distributionTitle,
      description: axis.distributionDescription,
      values: ranked.map((area) => area.componentScores[axis.key]),
      barColor: axis.chartColor,
    })),
  ]

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-teal-100 bg-white p-4 shadow-panel">
        <h2 className="text-lg font-semibold">How to use this app</h2>
        <p className="mt-2 text-sm text-slate-700">
          This tool helps you narrow down station areas with a workable 60-minute commute into
          central London before you spend time on listings, calls, and viewings.
        </p>
        <ol className="mt-3 space-y-2 text-sm text-slate-700">
          <li>1. Open `How It Works` once if you want a plain-English explanation of the data.</li>
          <li>2. Start with the `Balanced` preset in the filter panel.</li>
          <li>3. Use the Pinner drive filter only if access back to Pinner matters to you.</li>
          <li>4. Open `Ranked Table` to pin areas, then use `Map` and `Compare` to sense-check them.</li>
        </ol>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Primary-scope micro-areas" value={String(ranked.length)} />
        <StatCard label="Coverage-view candidates" value={String(londonWideCount)} />
        <StatCard label="Passing current filters" value={String(filtered.length)} />
        <StatCard
          label="Average weighted score"
          value={averageScore}
          hint="Based on active weights"
        />
        <StatCard
          label="Last refresh"
          value={formatDate(dataset.generatedAt)}
          hint={dataset.methodologyVersion}
        />
      </section>

      {dataset.verificationSummary ? (
        <section className="rounded-2xl border border-teal-100 bg-white p-4 shadow-panel">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
            Data Verification Status
          </h2>
          <p className="mt-2 text-sm text-slate-700">
            Overall:{' '}
            <span className="font-semibold">{dataset.verificationSummary.overallStatus}</span> |
            Crime live cross-check:{' '}
            <span className="font-semibold">
              {dataset.verificationSummary.crimeCrossCheckStatus}
            </span>{' '}
            | Data quality:{' '}
            <span className="font-semibold">
              {dataset.verificationSummary.dataQualityStatus ?? 'unknown'}
            </span>
            {typeof dataset.verificationSummary.qualityCriticalIssues === 'number' ? (
              <>
                {' '}
                (critical {dataset.verificationSummary.qualityCriticalIssues}, warning{' '}
                {dataset.verificationSummary.qualityWarningIssues ?? 0})
              </>
            ) : null}
            {' '}
            | Live mode: {dataset.verificationSummary.liveMode ? 'on' : 'off'}
          </p>
          {typeof dataset.verificationSummary.sourceCoverageScore === 'number' ? (
            <p className="mt-1 text-xs text-slate-600">
              Source coverage score:{' '}
              {(dataset.verificationSummary.sourceCoverageScore * 100).toFixed(1)}%
              {typeof dataset.verificationSummary.verificationStrengthScore === 'number'
                ? ` · verification strength ${(dataset.verificationSummary.verificationStrengthScore * 100).toFixed(1)}%`
                : ''}
            </p>
          ) : null}
          {dataset.config.stationUniverse ? (
            <p className="mt-1 text-xs text-slate-600">
              Station universe: raw {dataset.config.stationUniverse.rawStationCount ?? 'N/A'}, kept{' '}
              {dataset.config.stationUniverse.keptStationCount ?? 'N/A'}, excluded{' '}
              {dataset.config.stationUniverse.excludedStationCount ?? 'N/A'}.
            </p>
          ) : null}
          <p className="mt-1 text-xs text-slate-600">
            Verification generated {formatDate(dataset.verificationSummary.generatedAt)}. Full
            report:
            <a
              href={`${import.meta.env.BASE_URL}data/processed/verification_report.json`}
              target="_blank"
              rel="noreferrer"
              className="ml-1 text-surge hover:underline"
            >
              verification_report.json
            </a>
            <span className="mx-1">|</span>
            <a
              href={`${import.meta.env.BASE_URL}data/processed/data_quality_report.json`}
              target="_blank"
              rel="noreferrer"
              className="text-surge hover:underline"
            >
              data_quality_report.json
            </a>
          </p>
        </section>
      ) : null}

      <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-panel">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-amber-950">
          Trust and coverage
        </h2>
        <p className="mt-2 text-sm text-amber-950">
          The current dataset combines source-backed and modelled domains.{' '}
          <span className="font-semibold">{highConfidenceCount}</span> of{' '}
          <span className="font-semibold">{ranked.length}</span> default-scope areas meet the
          app&apos;s high-confidence threshold today.
        </p>
        <p className="mt-1 text-xs text-amber-900">
          This is now an informational trust readout, not a shortlist filter. Use it to gauge how
          much interpolation still sits under the current dataset.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {domainCoverage.map((domain) => (
            <span
              key={domain.key}
              className="rounded-full border border-amber-300 bg-white/70 px-3 py-1 text-xs text-amber-950"
            >
              {coverageLabelMap[domain.key]}: {domain.sourceAppliedPct}% source-backed ·{' '}
              {domain.availablePct}% populated
            </span>
          ))}
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <article className="rounded-2xl border border-teal-100 bg-white p-4 shadow-panel">
          <h2 className="text-lg font-semibold">Top ranked micro-areas</h2>
          <ul className="mt-3 space-y-2">
            {topFive.map((area, index) => (
              <li
                key={area.microAreaId}
                className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 px-3 py-2"
              >
                <div>
                  <p className="font-medium text-slate-800">
                    {index + 1}. {area.stationName}
                  </p>
                  <p className="text-xs text-slate-500">
                    Commute {area.commuteTypicalMinutes.value ?? 'N/A'} min | Drive{' '}
                    {area.driveTimeToPinnerMinutes.value ?? 'N/A'} min
                  </p>
                  <div className="mt-1">
                    <AreaTrustSummary area={area} compact />
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-lg font-semibold text-surge">
                    {area.dynamicOverallScore.toFixed(1)}
                  </p>
                  <Link
                    to={`/micro-area/${area.microAreaId}`}
                    state={{ from: fromPath }}
                    className="text-xs text-surge hover:underline"
                  >
                    Inspect
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        </article>

        <article className="rounded-2xl border border-teal-100 bg-white p-4 shadow-panel">
          <h2 className="text-lg font-semibold">Active scope</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between gap-2">
              <dt className="text-slate-600">Central destination</dt>
              <dd className="font-medium">{dataset.destinationStation}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-slate-600">Primary scope</dt>
              <dd className="font-medium">
                {dataset.config.primaryScopeRegion ?? 'Commute-defined commuter belt'} stations within{' '}
                {dataset.config.maxCommuteMinutesForCandidate} min
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-slate-600">Walk catchment</dt>
              <dd className="font-medium">{dataset.config.microAreaWalkRadiusM} m</dd>
            </div>
            {dataset.config.mainRoadExposureRadiusM ? (
              <div className="flex justify-between gap-2">
                <dt className="text-slate-600">Main-road exposure buffer</dt>
                <dd className="font-medium">{dataset.config.mainRoadExposureRadiusM} m</dd>
              </div>
            ) : null}
            <div className="flex justify-between gap-2">
              <dt className="text-slate-600">Pinner radius prefilter</dt>
              <dd className="font-medium">
                {dataset.config.defaultUsesPinnerRadiusPrefilter ? 'On' : 'Off'}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-slate-600">Pinner drive prefilter</dt>
              <dd className="font-medium">
                {dataset.config.defaultUsesDriveToPinnerPrefilter ? 'On' : 'Off'}
              </dd>
            </div>
            {dataset.config.boroughQolSource?.coveragePeriod ? (
              <div className="flex justify-between gap-2">
                <dt className="text-slate-600">ONS APS QoL context coverage</dt>
                <dd className="font-medium">{dataset.config.boroughQolSource.coveragePeriod}</dd>
              </div>
            ) : null}
            {dataset.config.boroughQolSource?.releaseDate ? (
              <div className="flex justify-between gap-2">
                <dt className="text-slate-600">ONS APS release date</dt>
                <dd className="font-medium">{dataset.config.boroughQolSource.releaseDate}</dd>
              </div>
            ) : null}
            {dataset.config.sourceMetadata?.transport?.releaseDate ? (
              <div className="flex justify-between gap-2">
                <dt className="text-slate-600">Transport source date</dt>
                <dd className="font-medium">{dataset.config.sourceMetadata.transport.releaseDate}</dd>
              </div>
            ) : null}
            {dataset.config.sourceMetadata?.pollution?.referencePeriod ? (
              <div className="flex justify-between gap-2">
                <dt className="text-slate-600">Pollution reference period</dt>
                <dd className="font-medium">{dataset.config.sourceMetadata.pollution.referencePeriod}</dd>
              </div>
            ) : null}
          </dl>
        </article>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <article className="rounded-2xl border border-teal-100 bg-white p-4 shadow-panel">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
            Top 20 by weighted score
          </h3>
          <TopScoresBarChart areas={filtered} />
        </article>
        <article className="rounded-2xl border border-teal-100 bg-white p-4 shadow-panel">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
            Commute time vs median semi price
          </h3>
          <CommutePriceScatter areas={filtered} />
        </article>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <article className="rounded-2xl border border-teal-100 bg-white p-4 shadow-panel">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
            Pollution vs green cover
          </h3>
          <EnvironmentScatter areas={filtered} />
        </article>
        <article className="rounded-2xl border border-teal-100 bg-white p-4 shadow-panel">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
            PM2.5 vs distance from central London
          </h3>
          <Pm25DistanceScatter
            areas={filtered}
            centralCoordinate={dataset.config.centralLondonCoordinate}
          />
        </article>
        <article className="rounded-2xl border border-teal-100 bg-white p-4 shadow-panel">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
            Borough QoL context vs distance from central London
          </h3>
          <QolDistanceScatter
            areas={filtered}
            centralCoordinate={dataset.config.centralLondonCoordinate}
          />
        </article>
      </section>

      <section className="rounded-2xl border border-teal-100 bg-white p-4 shadow-panel">
        <h2 className="text-lg font-semibold">All-area spread and standard deviation</h2>
        <p className="mt-2 text-sm text-slate-700">
          These cards use all <span className="font-semibold">{ranked.length}</span> default-scope
          micro-areas, not just the currently passing shortlist. They now mirror the active score
          axes so the spread view stays aligned with the ranking model.
        </p>
      </section>

      <section className="space-y-4">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
            Axis distributions
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            These spreads use the current weighting model for the overall score and the stored
            component scores for each ranking axis.
          </p>
        </div>
        <div className="grid gap-4 xl:grid-cols-2 2xl:grid-cols-3">
          {scoreDistributions.map((distribution) => (
            <MetricDistributionCard
              key={distribution.key}
              title={distribution.title}
              description={distribution.description}
              values={distribution.values}
              barColor={distribution.barColor}
            />
          ))}
        </div>
      </section>
    </div>
  )
}
