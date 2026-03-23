import { Link } from 'react-router-dom'

import { CommutePriceScatter } from '@/components/charts/CommutePriceScatter'
import { EnvironmentScatter } from '@/components/charts/EnvironmentScatter'
import { ScoreDistributionChart } from '@/components/charts/ScoreDistributionChart'
import { TopScoresBarChart } from '@/components/charts/TopScoresBarChart'
import { ErrorState } from '@/components/ErrorState'
import { LoadingState } from '@/components/LoadingState'
import { useDataContext } from '@/context/DataContext'
import { useRankedData } from '@/hooks/useRankedData'
import { formatDate } from '@/lib/format'

const StatCard = ({ label, value, hint }: { label: string; value: string; hint?: string }) => (
  <article className="rounded-2xl border border-teal-100 bg-white p-4 shadow-panel">
    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
    <p className="mt-1 text-2xl font-semibold text-slate-900">{value}</p>
    {hint ? <p className="mt-1 text-xs text-slate-600">{hint}</p> : null}
  </article>
)

export const OverviewPage = () => {
  const { dataset, loading, error } = useDataContext()
  const { ranked, filtered } = useRankedData()

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
  const averageScore = filtered.length
    ? (filtered.reduce((sum, area) => sum + area.dynamicOverallScore, 0) / filtered.length).toFixed(
        1,
      )
    : '0.0'

  return (
    <div className="space-y-6">
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total micro-areas analysed" value={String(ranked.length)} />
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
                </div>
                <div className="text-right">
                  <p className="text-lg font-semibold text-surge">
                    {area.dynamicOverallScore.toFixed(1)}
                  </p>
                  <Link
                    to={`/micro-area/${area.microAreaId}`}
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
              <dt className="text-slate-600">Search radius around Pinner</dt>
              <dd className="font-medium">{dataset.config.stationSearchRadiusKm} km</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-slate-600">Walk catchment</dt>
              <dd className="font-medium">{dataset.config.microAreaWalkRadiusM} m</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-slate-600">Candidate commute limit</dt>
              <dd className="font-medium">{dataset.config.maxCommuteMinutesForCandidate} min</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-slate-600">Candidate drive limit</dt>
              <dd className="font-medium">{dataset.config.maxDriveMinutesForCandidate} min</dd>
            </div>
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
            Score distribution
          </h3>
          <ScoreDistributionChart areas={filtered} />
        </article>
      </section>
    </div>
  )
}
