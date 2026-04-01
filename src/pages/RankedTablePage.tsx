import { DataMethodologyGuide } from '@/components/DataMethodologyGuide'
import { ErrorState } from '@/components/ErrorState'
import { FiltersPanel } from '@/components/FiltersPanel'
import { LoadingState } from '@/components/LoadingState'
import { RankedTable } from '@/components/table/RankedTable'
import { useDataContext } from '@/context/DataContext'
import { useSettings } from '@/context/SettingsContext'
import { useRankedData } from '@/hooks/useRankedData'
import { shortlistToCsv } from '@/lib/csv'
import { MapPage } from './MapPage'

const downloadCsv = (filename: string, data: string) => {
  const blob = new Blob([data], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

export const RankedTablePage = () => {
  const { loading, error, dataset } = useDataContext()
  const { filtered, pinned } = useRankedData()
  const { pinnedIds, togglePin } = useSettings()

  if (loading) {
    return <LoadingState title="Building ranked table" />
  }

  if (error || !dataset) {
    return (
      <ErrorState
        title="Ranked table unavailable"
        detail={error ?? 'Dataset is missing. Run the pipeline and sync processed files.'}
      />
    )
  }

  return (
    <div className="space-y-4">
      <FiltersPanel />

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-teal-100 bg-white p-4 shadow-panel">
        <p className="text-sm text-slate-700">
          {filtered.length} micro-areas match current constraints. Pin rows, then export your
          shortlist.
        </p>
        <button
          type="button"
          disabled={pinned.length === 0}
          onClick={() => downloadCsv('micro-area-shortlist.csv', shortlistToCsv(pinned))}
          className="rounded-lg bg-surge px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          Export pinned shortlist CSV ({pinned.length})
        </button>
      </div>

      <section className="rounded-2xl border border-teal-100 bg-white p-4 shadow-panel">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
          Filtered View
        </h2>
        <p className="mt-2 text-sm text-slate-700">
          This is the main working page for shortlist building. Use the filter box, scan the map,
          then work down the table and pin anything worth keeping.
        </p>
      </section>

      <MapPage showResultsList={false} />

      <details className="rounded-2xl border border-teal-100 bg-white p-4 shadow-panel">
        <summary className="cursor-pointer text-sm font-semibold uppercase tracking-wide text-slate-700">
          How key columns are determined
        </summary>
        <div className="mt-4">
          <DataMethodologyGuide variant="compact" />
        </div>
      </details>

      <RankedTable
        areas={filtered}
        pinnedIds={pinnedIds}
        onTogglePin={togglePin}
      />
    </div>
  )
}
