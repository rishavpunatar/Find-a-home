import { Link } from 'react-router-dom'

import { DataMethodologyGuide } from '@/components/DataMethodologyGuide'
import { ErrorState } from '@/components/ErrorState'
import { LoadingState } from '@/components/LoadingState'
import { useDataContext } from '@/context/DataContext'

export const SummaryPage = () => {
  const { loading, error, dataset } = useDataContext()

  if (loading) {
    return <LoadingState title="Loading overview" />
  }

  if (error || !dataset) {
    return (
      <ErrorState
        title="Overview unavailable"
        detail={error ?? 'Dataset is missing. Run the pipeline and sync processed files.'}
      />
    )
  }

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-teal-100 bg-white p-5 shadow-panel">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-surge">
          Overview
        </p>
        <h2 className="mt-2 text-2xl font-semibold text-slate-900">
          A plain-English guide to what this app is measuring and how to use it
        </h2>
        <div className="mt-3 max-w-4xl space-y-2 text-sm text-slate-700">
          <p>
            This page is for someone who wants to understand the ranking without reading pipeline
            code or raw JSON. It explains what each score means, where the numbers come from, and
            where the weaker parts of the dataset still are.
          </p>
          <p>
            If you want the shortest practical workflow, start on{' '}
            <Link to="/filtered" className="font-medium text-surge hover:underline">
              Filtered View
            </Link>
            , use the filters and map to make a shortlist, then switch to{' '}
            <Link to="/trends" className="font-medium text-surge hover:underline">
              Trends
            </Link>{' '}
            if you want to inspect how metrics vary across the wider London dataset.
          </p>
        </div>
      </section>

      <DataMethodologyGuide variant="full" />
    </div>
  )
}
