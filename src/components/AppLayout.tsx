import { NavLink, Outlet } from 'react-router-dom'
import { useMemo, useState } from 'react'

import { useDataContext } from '@/context/DataContext'
import { useSettings } from '@/context/SettingsContext'
import { formatDate } from '@/lib/format'

import { FiltersPanel } from './FiltersPanel'
import { SettingsPanel } from './SettingsPanel'

const navItems = [
  { to: '/', label: 'Overview' },
  { to: '/ranked', label: 'Ranked Table' },
  { to: '/map', label: 'Map' },
  { to: '/compare', label: 'Compare' },
]

export const AppLayout = () => {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const { dataset } = useDataContext()
  const { pinnedIds, compareIds } = useSettings()

  const generatedLabel = useMemo(() => {
    if (!dataset) {
      return 'Loading dataset...'
    }

    return `Dataset refreshed ${formatDate(dataset.generatedAt)}`
  }, [dataset])

  return (
    <div className="min-h-screen bg-gradient-to-br from-mist via-white to-teal-50 text-slate-900">
      <header className="sticky top-0 z-20 border-b border-teal-100 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-surge">
                Find a Home
              </p>
              <h1 className="text-xl font-semibold sm:text-2xl">
                Station-Centred Micro-Area Ranking Around Pinner
              </h1>
              <p className="text-sm text-slate-600">{generatedLabel}</p>
            </div>

            <div className="flex items-center gap-2">
              <span className="rounded-full bg-teal-50 px-3 py-1 text-xs font-medium text-slate-700">
                Pinned: {pinnedIds.length}
              </span>
              <span className="rounded-full bg-cyan-50 px-3 py-1 text-xs font-medium text-slate-700">
                Compare: {compareIds.length}/5
              </span>
              <button
                type="button"
                onClick={() => setSettingsOpen((current) => !current)}
                className="rounded-lg bg-ink px-3 py-2 text-sm font-medium text-white transition hover:bg-slate-700"
              >
                {settingsOpen ? 'Close Weights' : 'Weights'}
              </button>
            </div>
          </div>

          <nav className="flex flex-wrap gap-2">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  [
                    'rounded-lg px-3 py-1.5 text-sm font-medium transition',
                    isActive
                      ? 'bg-surge text-white'
                      : 'bg-teal-50 text-slate-700 hover:bg-teal-100',
                  ].join(' ')
                }
                end={item.to === '/'}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <FiltersPanel />
        {settingsOpen ? <SettingsPanel onClose={() => setSettingsOpen(false)} /> : null}
        <Outlet />
      </main>
    </div>
  )
}
