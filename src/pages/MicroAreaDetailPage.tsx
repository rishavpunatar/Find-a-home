import { useMemo } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'

import { AreaTrustSummary } from '@/components/AreaTrustSummary'
import { ErrorState } from '@/components/ErrorState'
import { LoadingState } from '@/components/LoadingState'
import { StatusPill } from '@/components/StatusPill'
import { SubscoreRadarChart } from '@/components/charts/SubscoreRadarChart'
import { useDataContext } from '@/context/DataContext'
import { useRankedData } from '@/hooks/useRankedData'
import {
  describeMetricEvidence,
  getAreaDomainStatuses,
  getAreaPropertyEvidenceLabel,
} from '@/lib/dataQuality'
import { buildRankingExplanation } from '@/lib/scoring'
import { formatCurrency, formatDate, formatNumber, formatPercent } from '@/lib/format'

const domainLabelMap = {
  property: 'Property',
  transport: 'Transport',
  schools: 'Schools',
  pollution: 'Pollution',
  greenSpace: 'Green',
  crime: 'Crime',
  planning: 'Planning',
  wellbeing: 'Wellbeing',
} as const

const MetricRow = ({
  label,
  value,
  status,
  confidence,
  provenance,
  note,
  updated,
}: {
  label: string
  value: string
  status: 'available' | 'estimated' | 'placeholder' | 'missing'
  confidence: number
  provenance: string | undefined
  note: string
  updated: string
}) => (
  <div className="rounded-xl border border-slate-200 p-3">
    <div className="flex items-start justify-between gap-2">
      <div>
        <p className="text-sm font-medium text-slate-800">{label}</p>
        <p className="text-lg font-semibold text-slate-900">{value}</p>
      </div>
      <StatusPill status={status} />
    </div>
    <p className="mt-1 text-xs text-slate-600">Confidence: {(confidence * 100).toFixed(0)}%</p>
    <p className="mt-1 text-xs text-slate-600">Evidence: {describeMetricEvidence(provenance)}</p>
    <p className="mt-1 text-xs text-slate-600">Method: {note}</p>
    <p className="mt-1 text-xs text-slate-500">Last updated: {formatDate(updated)}</p>
  </div>
)

export const MicroAreaDetailPage = () => {
  const { microAreaId } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const { loading, error } = useDataContext()
  const { ranked } = useRankedData()
  const fromPath =
    typeof (location.state as { from?: unknown } | null)?.from === 'string'
      ? ((location.state as { from?: string }).from ?? '/filtered')
      : '/filtered'

  const area = useMemo(
    () => ranked.find((item) => item.microAreaId === microAreaId),
    [microAreaId, ranked],
  )

  if (loading) {
    return <LoadingState title="Loading micro-area details" />
  }

  if (error) {
    return <ErrorState title="Detail page unavailable" detail={error} />
  }

  if (!area) {
    return (
      <ErrorState
        title="Micro-area not found"
        detail="The requested area ID is missing from the current filtered ranking dataset."
      />
    )
  }

  const explanation = area.rankingExplanationRules.length
    ? area.rankingExplanationRules
    : buildRankingExplanation(area)
  const domainStatuses = getAreaDomainStatuses(area)

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-teal-100 bg-white p-4 shadow-panel">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Micro-area detail
        </p>
        <h2 className="text-2xl font-semibold">{area.stationName}</h2>
        <p className="text-sm text-slate-600">
          {area.localAuthority}, {area.countyOrBorough} | Station code: {area.stationCode}
        </p>
        <p className="mt-2 text-sm text-slate-700">
          Overall weighted score:{' '}
          <span className="font-semibold text-surge">{area.dynamicOverallScore.toFixed(1)}</span>
          {' · '}Data confidence: {(area.dataConfidenceScore * 100).toFixed(0)}%
        </p>
        <p className="mt-1 text-xs text-slate-600">
          Property evidence: {getAreaPropertyEvidenceLabel(area)}
        </p>
        <div className="mt-3">
          <AreaTrustSummary area={area} />
        </div>
        <button
          type="button"
          onClick={() => {
            void navigate(fromPath)
          }}
          className="mt-3 inline-flex rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
        >
          Back to previous view
        </button>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <article className="rounded-2xl border border-teal-100 bg-white p-4 shadow-panel">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
            Why this ranks where it does
          </h3>
          <ul className="mt-3 space-y-2 text-sm text-slate-700">
            {explanation.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
            <p className="font-semibold">Methodology confidence notes</p>
            <ul className="mt-2 list-disc pl-4 text-slate-600">
              {area.confidenceNotes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </div>
          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
            <p className="font-semibold">Domain availability snapshot</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {Object.entries(domainStatuses).map(([key, status]) => (
                <span
                  key={key}
                  className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1"
                >
                  <span className="text-slate-700">{domainLabelMap[key as keyof typeof domainLabelMap]}</span>
                  <StatusPill status={status} />
                </span>
              ))}
            </div>
          </div>
        </article>

        <article className="rounded-2xl border border-teal-100 bg-white p-4 shadow-panel">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
            Sub-score radar
          </h3>
          <SubscoreRadarChart area={area} />
        </article>
      </section>

      <section className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <MetricRow
          label="Median semi-detached price"
          value={formatCurrency(area.medianSemiDetachedPrice.value)}
          status={area.medianSemiDetachedPrice.status}
          confidence={area.medianSemiDetachedPrice.confidence}
          provenance={area.medianSemiDetachedPrice.provenance}
          note={area.medianSemiDetachedPrice.methodologyNote}
          updated={area.medianSemiDetachedPrice.lastUpdated}
        />
        <MetricRow
          label="Typical commute"
          value={`${formatNumber(area.commuteTypicalMinutes.value)} min`}
          status={area.commuteTypicalMinutes.status}
          confidence={area.commuteTypicalMinutes.confidence}
          provenance={area.commuteTypicalMinutes.provenance}
          note={area.commuteTypicalMinutes.methodologyNote}
          updated={area.commuteTypicalMinutes.lastUpdated}
        />
        <MetricRow
          label="Drive time to Pinner"
          value={`${formatNumber(area.driveTimeToPinnerMinutes.value)} min`}
          status={area.driveTimeToPinnerMinutes.status}
          confidence={area.driveTimeToPinnerMinutes.confidence}
          provenance={area.driveTimeToPinnerMinutes.provenance}
          note={area.driveTimeToPinnerMinutes.methodologyNote}
          updated={area.driveTimeToPinnerMinutes.lastUpdated}
        />
        <MetricRow
          label="Primary school quality"
          value={formatNumber(area.primaryQualityScore.value, 1)}
          status={area.primaryQualityScore.status}
          confidence={area.primaryQualityScore.confidence}
          provenance={area.primaryQualityScore.provenance}
          note={area.schoolMethodologyNotes}
          updated={area.primaryQualityScore.lastUpdated}
        />
        <MetricRow
          label="Secondary school quality"
          value={formatNumber(area.secondaryQualityScore.value, 1)}
          status={area.secondaryQualityScore.status}
          confidence={area.secondaryQualityScore.confidence}
          provenance={area.secondaryQualityScore.provenance}
          note={area.schoolMethodologyNotes}
          updated={area.secondaryQualityScore.lastUpdated}
        />
        <MetricRow
          label="Crime rate per 1,000"
          value={formatNumber(area.crimeRatePerThousand.value, 1)}
          status={area.crimeRatePerThousand.status}
          confidence={area.crimeRatePerThousand.confidence}
          provenance={area.crimeRatePerThousand.provenance}
          note={area.crimeRatePerThousand.methodologyNote}
          updated={area.crimeRatePerThousand.lastUpdated}
        />
        <MetricRow
          label="PM2.5 annual mean (primary)"
          value={`${formatNumber(area.annualPm25.value, 1)} ug/m3`}
          status={area.annualPm25.status}
          confidence={area.annualPm25.confidence}
          provenance={area.annualPm25.provenance}
          note={area.annualPm25.methodologyNote}
          updated={area.annualPm25.lastUpdated}
        />
        <MetricRow
          label="NO2 annual mean (secondary)"
          value={`${formatNumber(area.annualNo2.value, 1)} ug/m3`}
          status={area.annualNo2.status}
          confidence={area.annualNo2.confidence}
          provenance={area.annualNo2.provenance}
          note={area.annualNo2.methodologyNote}
          updated={area.annualNo2.lastUpdated}
        />
        <MetricRow
          label="Green cover"
          value={formatPercent(area.greenCoverPct.value)}
          status={area.greenCoverPct.status}
          confidence={area.greenCoverPct.confidence}
          provenance={area.greenCoverPct.provenance}
          note={area.greenCoverPct.methodologyNote}
          updated={area.greenCoverPct.lastUpdated}
        />
        <MetricRow
          label="Borough QoL score (ONS APS)"
          value={formatNumber(area.boroughQolScore.value, 1)}
          status={area.boroughQolScore.status}
          confidence={area.boroughQolScore.confidence}
          provenance={area.boroughQolScore.provenance}
          note={area.boroughQolMethodology}
          updated={area.boroughQolScore.lastUpdated}
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <article className="rounded-2xl border border-teal-100 bg-white p-4 shadow-panel">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
            Nearby schools summary
          </h3>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-600">Primary schools in catchment + fringe</dt>
              <dd className="font-medium">{formatNumber(area.nearbyPrimaryCount.value)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-600">Secondary schools in catchment + fringe</dt>
              <dd className="font-medium">{formatNumber(area.nearbySecondaryCount.value)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-600">Primary quality score</dt>
              <dd className="font-medium">{formatNumber(area.primaryQualityScore.value, 1)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-600">Secondary quality score</dt>
              <dd className="font-medium">{formatNumber(area.secondaryQualityScore.value, 1)}</dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-slate-600">
            Count and quality inputs use state-funded-only DfE school data, so private schools
            are excluded from both the nearby totals and the quality component. School access here
            is based on roughly 20 minutes drive from the area anchor.
          </p>
          <p className="mt-3 text-xs text-slate-600">{area.schoolMethodologyNotes}</p>
        </article>

        <article className="rounded-2xl border border-teal-100 bg-white p-4 shadow-panel">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
            Nearby parks and environment
          </h3>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-600">Green space within 1 km</dt>
              <dd className="font-medium">
                {formatNumber(area.greenSpaceAreaKm2Within1km.value, 2)} km²
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-600">Nearest park distance</dt>
              <dd className="font-medium">{formatNumber(area.nearestParkDistanceM.value)} m</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-600">Planning risk heuristic</dt>
              <dd className="font-medium">{formatNumber(area.planningRiskHeuristic.value, 1)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-600">Borough QoL authority link</dt>
              <dd className="font-medium">{area.boroughQolAuthority || 'N/A'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-600">Borough QoL period</dt>
              <dd className="font-medium">{area.boroughQolPeriod || 'N/A'}</dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-slate-600">{area.planningRiskMethodology}</p>
        </article>
      </section>

      {area.flags.length ? (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <h3 className="font-semibold">Lower-confidence or missing-data flags</h3>
          <ul className="mt-2 list-disc pl-5">
            {area.flags.map((flag) => (
              <li key={flag}>{flag}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}
