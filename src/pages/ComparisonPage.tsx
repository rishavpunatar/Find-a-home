import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { AreaTrustSummary } from '@/components/AreaTrustSummary'
import { CommutePriceScatter } from '@/components/charts/CommutePriceScatter'
import { EnvironmentScatter } from '@/components/charts/EnvironmentScatter'
import { ErrorState } from '@/components/ErrorState'
import { LoadingState } from '@/components/LoadingState'
import { Pm25DistanceScatter } from '@/components/charts/Pm25DistanceScatter'
import { QolDistanceScatter } from '@/components/charts/QolDistanceScatter'
import { SubscoreRadarChart } from '@/components/charts/SubscoreRadarChart'
import { useDataContext } from '@/context/DataContext'
import { useRankedData } from '@/hooks/useRankedData'

export const ComparisonPage = () => {
  const { dataset, loading, error } = useDataContext()
  const { compared, filtered } = useRankedData()

  if (loading) {
    return <LoadingState title="Preparing comparison view" />
  }

  if (error || !dataset) {
    return (
      <ErrorState
        title="Comparison unavailable"
        detail={error ?? 'Dataset is missing. Run the pipeline and sync processed files.'}
      />
    )
  }

  if (compared.length === 0) {
    return (
      <ErrorState
        title="No areas selected for comparison"
        detail="Use the Ranked Table page and click Compare on up to 5 micro-areas."
      />
    )
  }

  const componentData = compared.map((area) => ({
    name: area.stationName,
    value: area.componentScores.value,
    transport: area.componentScores.transport,
    schools: area.componentScores.schools,
    environment: area.componentScores.environment,
    crime: area.componentScores.crime,
    proximity: area.componentScores.proximity,
    planningRisk: area.componentScores.planningRisk,
  }))

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-teal-100 bg-white p-4 shadow-panel">
        <h2 className="text-lg font-semibold">Selected micro-areas ({compared.length})</h2>
        <p className="mt-1 text-sm text-slate-600">
          You can compare up to five areas side by side. Revisit the ranked table to adjust
          selection.
        </p>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        {compared.map((area) => (
          <article
            key={area.microAreaId}
            className="rounded-2xl border border-teal-100 bg-white p-4 shadow-panel"
          >
            <h3 className="text-base font-semibold">{area.stationName}</h3>
            <p className="text-sm text-slate-600">
              Overall score: {area.dynamicOverallScore.toFixed(1)}
            </p>
            <div className="mt-2">
              <AreaTrustSummary area={area} />
            </div>
            <SubscoreRadarChart area={area} />
          </article>
        ))}
      </section>

      <section className="rounded-2xl border border-teal-100 bg-white p-4 shadow-panel">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
          Grouped component score comparison
        </h3>
        <div className="h-[420px] w-full">
          <ResponsiveContainer>
            <BarChart data={componentData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis domain={[0, 100]} />
              <Tooltip />
              <Legend />
              <Bar dataKey="value" fill="#0f766e" />
              <Bar dataKey="transport" fill="#0284c7" />
              <Bar dataKey="schools" fill="#65a30d" />
              <Bar dataKey="environment" fill="#16a34a" />
              <Bar dataKey="crime" fill="#0891b2" />
              <Bar dataKey="proximity" fill="#f59e0b" />
              <Bar dataKey="planningRisk" fill="#7c3aed" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <article className="rounded-2xl border border-teal-100 bg-white p-4 shadow-panel">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
            Commute vs median semi price (filtered set)
          </h3>
          <CommutePriceScatter areas={filtered} />
        </article>
        <article className="rounded-2xl border border-teal-100 bg-white p-4 shadow-panel">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
            Pollution vs green space (filtered set)
          </h3>
          <EnvironmentScatter areas={filtered} />
        </article>
        <article className="rounded-2xl border border-teal-100 bg-white p-4 shadow-panel">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
            PM2.5 vs distance from central London (filtered set)
          </h3>
          <Pm25DistanceScatter
            areas={filtered}
            centralCoordinate={dataset.config.centralLondonCoordinate}
          />
        </article>
        <article className="rounded-2xl border border-teal-100 bg-white p-4 shadow-panel">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
            Borough QoL vs distance from central London (filtered set)
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
