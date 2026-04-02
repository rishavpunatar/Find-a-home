import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'

import { ErrorState } from '@/components/ErrorState'
import { LoadingState } from '@/components/LoadingState'
import {
  type ColorMetric,
  type MapViewport,
  MicroAreaMap,
} from '@/components/map/MicroAreaMap'
import { useDataContext } from '@/context/DataContext'
import { useRankedData } from '@/hooks/useRankedData'
import { formatCurrency, formatNumber } from '@/lib/format'
import { rankingAxes } from '@/lib/rankingAxes'

const colorOptions: Array<{ value: ColorMetric; label: string }> = [
  { value: 'overall', label: 'Overall score' },
  ...rankingAxes.map((axis) => ({
    value: axis.key as ColorMetric,
    label: axis.label,
  })),
]

const DEFAULT_VIEWPORT: MapViewport = {
  lat: 51.515,
  lon: -0.142,
  zoom: 9,
}

const METRIC_KEYS = new Set(colorOptions.map((option) => option.value))

const parseMetric = (value: string | null): ColorMetric =>
  value && METRIC_KEYS.has(value as ColorMetric) ? (value as ColorMetric) : 'overall'

const parseNumber = (value: string | null, fallback: number): number => {
  if (!value) {
    return fallback
  }
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

const parseBoolean = (value: string | null, fallback: boolean): boolean => {
  if (value === '1') {
    return true
  }
  if (value === '0') {
    return false
  }
  return fallback
}

const fromPathString = (pathname: string, search: string) => `${pathname}${search}`

interface MapPageProps {
  showResultsList?: boolean
}

export const MapPage = ({ showResultsList = true }: MapPageProps = {}) => {
  const { loading, error } = useDataContext()
  const { filtered } = useRankedData()
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()

  const [metric, setMetric] = useState<ColorMetric>(() => parseMetric(searchParams.get('metric')))
  const [showMarkers, setShowMarkers] = useState<boolean>(() =>
    parseBoolean(searchParams.get('markers'), true),
  )
  const [selectedAreaId, setSelectedAreaId] = useState<string | null>(() => searchParams.get('sel'))
  const [focusAreaId, setFocusAreaId] = useState<string | null>(() => searchParams.get('sel'))
  const [hoveredAreaId, setHoveredAreaId] = useState<string | null>(null)
  const [stationQuery, setStationQuery] = useState('')
  const [searchFeedback, setSearchFeedback] = useState<string>('')
  const [viewport, setViewport] = useState<MapViewport>(() => ({
    lat: parseNumber(searchParams.get('lat'), DEFAULT_VIEWPORT.lat),
    lon: parseNumber(searchParams.get('lon'), DEFAULT_VIEWPORT.lon),
    zoom: Math.max(6, Math.min(18, Math.round(parseNumber(searchParams.get('z'), DEFAULT_VIEWPORT.zoom)))),
  }))
  const effectiveSelectedAreaId =
    selectedAreaId && filtered.some((area) => area.microAreaId === selectedAreaId)
      ? selectedAreaId
      : null

  const fromPath = fromPathString(location.pathname, location.search)

  useEffect(() => {
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous)
        const metricValue = metric
        const latValue = viewport.lat.toFixed(5)
        const lonValue = viewport.lon.toFixed(5)
        const zoomValue = String(Math.round(viewport.zoom))
        const markerValue = showMarkers ? '1' : '0'
        let changed = false

        if (next.get('metric') !== metricValue) {
          next.set('metric', metricValue)
          changed = true
        }
        if (next.get('lat') !== latValue) {
          next.set('lat', latValue)
          changed = true
        }
        if (next.get('lon') !== lonValue) {
          next.set('lon', lonValue)
          changed = true
        }
        if (next.get('z') !== zoomValue) {
          next.set('z', zoomValue)
          changed = true
        }
        if (next.get('markers') !== markerValue) {
          next.set('markers', markerValue)
          changed = true
        }

        if (effectiveSelectedAreaId) {
          if (next.get('sel') !== effectiveSelectedAreaId) {
            next.set('sel', effectiveSelectedAreaId)
            changed = true
          }
        } else if (next.has('sel')) {
          next.delete('sel')
          changed = true
        }

        return changed ? next : previous
      },
      { replace: true },
    )
  }, [
    effectiveSelectedAreaId,
    metric,
    setSearchParams,
    showMarkers,
    viewport.lat,
    viewport.lon,
    viewport.zoom,
  ])

  const stationChoices = useMemo(
    () =>
      [...filtered]
        .sort((left, right) => left.stationName.localeCompare(right.stationName))
        .slice(0, 700),
    [filtered],
  )

  const selectedArea = effectiveSelectedAreaId
    ? (filtered.find((area) => area.microAreaId === effectiveSelectedAreaId) ?? null)
    : null

  const handleSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const normalized = stationQuery.trim().toLowerCase()

    if (!normalized) {
      setSearchFeedback('Type a station name to jump on the map.')
      return
    }

    const exact = filtered.find(
      (area) =>
        area.stationName.toLowerCase() === normalized || area.stationCode.toLowerCase() === normalized,
    )
    const startsWith = filtered.find((area) => area.stationName.toLowerCase().startsWith(normalized))
    const includes = filtered.find((area) => area.stationName.toLowerCase().includes(normalized))
    const match = exact ?? startsWith ?? includes

    if (!match) {
      setSearchFeedback('No station match in the current filtered map scope.')
      return
    }

    setSelectedAreaId(match.microAreaId)
    setFocusAreaId(match.microAreaId)
    setStationQuery(match.stationName)
    setSearchFeedback(`Jumped to ${match.stationName}.`)
  }

  if (loading) {
    return <LoadingState title="Loading map layer" />
  }

  if (error) {
    return <ErrorState title="Map unavailable" detail={error} />
  }

  return (
    <div id="filtered-map" className="space-y-4">
      <section className="rounded-2xl border border-teal-100 bg-white p-4 shadow-panel">
        <div className="grid gap-4 lg:grid-cols-[1fr_1fr_auto]">
          <form onSubmit={handleSearch} className="space-y-2">
            <label className="text-sm font-medium text-slate-700" htmlFor="mapStationSearch">
              Station search (jump + highlight)
            </label>
            <div className="flex gap-2">
              <input
                id="mapStationSearch"
                list="map-station-options"
                value={stationQuery}
                onChange={(event) => setStationQuery(event.currentTarget.value)}
                placeholder="Type station name..."
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
              <button
                type="submit"
                className="rounded-lg bg-ink px-3 py-2 text-sm font-medium text-white hover:bg-slate-700"
              >
                Jump
              </button>
            </div>
            <datalist id="map-station-options">
              {stationChoices.map((area) => (
                <option key={area.microAreaId} value={area.stationName} />
              ))}
            </datalist>
            <p className="text-xs text-slate-600">{searchFeedback || ' '}</p>
          </form>

          <div>
            <label className="text-sm font-medium text-slate-700" htmlFor="mapMetric">
              Colour micro-areas by score axis
            </label>
            <select
              id="mapMetric"
              value={metric}
              onChange={(event) => setMetric(event.currentTarget.value as ColorMetric)}
              className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              {colorOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <div>
                <p className="text-sm font-medium text-slate-800">Blue teardrop pins</p>
                <p className="text-xs text-slate-600">
                  Turn off the Leaflet station pins if you only want the score circles.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowMarkers((current) => !current)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium ${
                  showMarkers
                    ? 'bg-teal-600 text-white'
                    : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                {showMarkers ? 'Hide blue pins' : 'Show blue pins'}
              </button>
            </div>
          </div>

          <div className="flex flex-col justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setSelectedAreaId(null)
                setFocusAreaId(null)
                setHoveredAreaId(null)
              }}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Clear selection
            </button>
            <p className="text-xs text-slate-600">
              Showing {filtered.length} map micro-areas
            </p>
          </div>
        </div>
        {selectedArea ? (
          <p className="mt-3 text-sm text-slate-700">
            Selected: <span className="font-semibold">{selectedArea.stationName}</span> | Score{' '}
            {selectedArea.dynamicOverallScore.toFixed(1)} | Commute{' '}
            {formatNumber(selectedArea.commuteTypicalMinutes.value)} min
          </p>
        ) : (
          <p className="mt-3 text-sm text-slate-600">
            Select any map circle/pin or use the keyboard list below to highlight a micro-area.
          </p>
        )}
      </section>

      <MicroAreaMap
        areas={filtered}
        metric={metric}
        selectedAreaId={effectiveSelectedAreaId}
        hoveredAreaId={hoveredAreaId}
        focusAreaId={focusAreaId}
        showMarkers={showMarkers}
        initialCenter={[viewport.lat, viewport.lon]}
        initialZoom={viewport.zoom}
        onSelectArea={(id) => {
          setSelectedAreaId(id)
          setFocusAreaId(null)
        }}
        onHoverArea={setHoveredAreaId}
        onShowMarkersChange={setShowMarkers}
        onViewportChange={setViewport}
      />

      {showResultsList ? (
        <section className="rounded-2xl border border-teal-100 bg-white p-4 shadow-panel">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
            Map Results List (Keyboard Accessible)
          </h2>
          <p className="mt-2 text-sm text-slate-600">
            Tab into rows, press Enter/Space to focus that area on the map. Hover/focus states are
            synchronized with the map highlight.
          </p>
          <div className="mt-3 max-h-[420px] overflow-auto rounded-xl border border-slate-200">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="sticky top-0 bg-slate-50">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                    Area
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                    Score
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                    Commute
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                    Median Semi
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((area) => {
                  const isSelected = area.microAreaId === effectiveSelectedAreaId
                  const isHovered = area.microAreaId === hoveredAreaId
                  return (
                    <tr
                      key={area.microAreaId}
                      className={
                        isSelected
                          ? 'bg-teal-100/60'
                          : isHovered
                            ? 'bg-teal-50'
                            : 'hover:bg-slate-50'
                      }
                    >
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          className="text-left font-medium text-slate-800 hover:text-surge hover:underline"
                          onClick={() => {
                            setSelectedAreaId(area.microAreaId)
                            setFocusAreaId(area.microAreaId)
                          }}
                          onMouseEnter={() => setHoveredAreaId(area.microAreaId)}
                          onMouseLeave={() => setHoveredAreaId(null)}
                          onFocus={() => setHoveredAreaId(area.microAreaId)}
                          onBlur={() => setHoveredAreaId(null)}
                        >
                          {area.stationName}
                        </button>
                        <p className="text-xs text-slate-500">{area.localAuthority}</p>
                      </td>
                      <td className="px-3 py-2">{area.dynamicOverallScore.toFixed(1)}</td>
                      <td className="px-3 py-2">{formatNumber(area.commuteTypicalMinutes.value)} min</td>
                      <td className="px-3 py-2">{formatCurrency(area.medianSemiDetachedPrice.value)}</td>
                      <td className="px-3 py-2">
                        <Link
                          to={`/micro-area/${area.microAreaId}`}
                          state={{ from: fromPath }}
                          className="text-surge hover:underline"
                        >
                          Detail
                        </Link>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  )
}
