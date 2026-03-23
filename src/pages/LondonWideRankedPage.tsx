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
  const { loading, error } = useDataContext()
  const { pinnedIds, compareIds, togglePin, toggleCompare } = useSettings()
  const { filtered, pinned, effectiveFilters } = useRankedData({
    maxCommuteMinutesCap: LONDON_WIDE_COMMUTE_CAP_MINUTES,
    ignoreMaxDriveMinutes: true,
  })

  if (loading) {
    return <LoadingState title="Building London-wide ranked table" />
  }

  if (error) {
    return <ErrorState title="London-wide ranked table unavailable" detail={error} />
  }

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-teal-100 bg-white p-4 shadow-panel">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
          London-wide commute mode
        </h2>
        <p className="mt-2 text-sm text-slate-700">
          This view enforces <span className="font-semibold">commute up to 60 minutes</span> and
          intentionally ignores the drive-to-Pinner filter. All other active filters still apply.
        </p>
        <p className="mt-1 text-xs text-slate-600">
          Effective filters: commute ≤ {effectiveFilters.maxCommuteMinutes} min, schools ≥{' '}
          {effectiveFilters.minSchoolScore}, crime ≤ {effectiveFilters.maxCrimeRatePerThousand},
          NO2 ≤ {effectiveFilters.maxNo2}, green ≥ {effectiveFilters.minGreenCoverPct}%, median
          semi price ≤ £{effectiveFilters.maxMedianPrice.toLocaleString('en-GB')}.
        </p>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-teal-100 bg-white p-4 shadow-panel">
        <p className="text-sm text-slate-700">
          {filtered.length} micro-areas match London-wide mode. Pin rows, then export your
          shortlist.
        </p>
        <button
          type="button"
          disabled={pinned.length === 0}
          onClick={() => downloadCsv('micro-area-shortlist-london-wide.csv', shortlistToCsv(pinned))}
          className="rounded-lg bg-surge px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          Export pinned shortlist CSV ({pinned.length})
        </button>
      </div>

      <RankedTable
        areas={filtered}
        pinnedIds={pinnedIds}
        compareIds={compareIds}
        onTogglePin={togglePin}
        onToggleCompare={toggleCompare}
      />
    </div>
  )
}
