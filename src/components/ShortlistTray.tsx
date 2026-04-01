import { useMemo } from 'react'
import { Link, useLocation } from 'react-router-dom'

import { useDataContext } from '@/context/DataContext'
import { useSettings } from '@/context/SettingsContext'

const MAX_VISIBLE_ITEMS = 8

export const ShortlistTray = () => {
  const location = useLocation()
  const { dataset } = useDataContext()
  const { pinnedIds, togglePin } = useSettings()

  const fromPath = `${location.pathname}${location.search}`

  const areaById = useMemo(() => {
    const map = new Map<string, { microAreaId: string; stationName: string }>()
    const rows = [...(dataset?.microAreas ?? []), ...(dataset?.londonWideMicroAreas ?? [])]
    for (const area of rows) {
      if (!map.has(area.microAreaId)) {
        map.set(area.microAreaId, {
          microAreaId: area.microAreaId,
          stationName: area.stationName,
        })
      }
    }
    return map
  }, [dataset])

  const pinnedAreas = pinnedIds
    .map((id) => areaById.get(id))
    .filter((area): area is { microAreaId: string; stationName: string } => Boolean(area))

  return (
    <aside className="fixed inset-x-0 bottom-0 z-30 border-t border-teal-200 bg-white/95 shadow-[0_-8px_24px_rgba(15,23,42,0.08)] backdrop-blur">
      <div className="mx-auto max-w-7xl px-4 py-2 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-700">
            Sticky shortlist tray
          </p>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-full bg-teal-50 px-2.5 py-1 text-slate-700">
              Pinned: {pinnedIds.length}
            </span>
            <Link
              to="/filtered"
              className="rounded-md bg-slate-100 px-2.5 py-1 text-slate-700 hover:bg-slate-200"
            >
              Open Filtered View
            </Link>
          </div>
        </div>

        <div className="mt-2 rounded-lg border border-teal-100 bg-teal-50/60 px-2 py-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">
            Pinned areas
          </p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {pinnedAreas.length > 0 ? (
              pinnedAreas.slice(0, MAX_VISIBLE_ITEMS).map((area) => (
                <span
                  key={`pin-${area.microAreaId}`}
                  className="inline-flex items-center gap-1 rounded-full border border-teal-200 bg-white px-2 py-0.5 text-xs"
                >
                  <Link
                    to={`/micro-area/${area.microAreaId}`}
                    state={{ from: fromPath }}
                    className="text-slate-700 hover:text-surge hover:underline"
                  >
                    {area.stationName}
                  </Link>
                  <button
                    type="button"
                    onClick={() => togglePin(area.microAreaId)}
                    className="text-slate-500 hover:text-rose-600"
                    aria-label={`Remove ${area.stationName} from pinned`}
                  >
                    ×
                  </button>
                </span>
              ))
            ) : (
              <p className="text-xs text-slate-500">No pinned areas yet.</p>
            )}
            {pinnedAreas.length > MAX_VISIBLE_ITEMS ? (
              <span className="inline-flex items-center rounded-full border border-teal-200 bg-white px-2 py-0.5 text-xs text-slate-500">
                +{pinnedAreas.length - MAX_VISIBLE_ITEMS} more
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </aside>
  )
}
