import 'leaflet/dist/leaflet.css'

import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import L from 'leaflet'
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png'
import markerIcon from 'leaflet/dist/images/marker-icon.png'
import markerShadow from 'leaflet/dist/images/marker-shadow.png'
import { Circle, MapContainer, Marker, Popup, TileLayer } from 'react-leaflet'

import type { ComponentScores, DerivedMicroArea } from '@/types/domain'

import { formatCurrency, formatNumber } from '@/lib/format'

L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
})

export type ColorMetric = 'overall' | keyof ComponentScores

const mapMetricLabel: Record<ColorMetric, string> = {
  overall: 'Overall score',
  value: 'Value score',
  transport: 'Transport score',
  schools: 'School score',
  environment: 'Environment score',
  crime: 'Crime score',
  proximity: 'Pinner proximity score',
  planningRisk: 'Planning risk score',
}

const LEGEND_COLORS = [
  '#7f1d1d',
  '#b91c1c',
  '#ea580c',
  '#f59e0b',
  '#84cc16',
  '#22c55e',
  '#059669',
] as const

const colorAt = (index: number): string =>
  LEGEND_COLORS[index] ?? LEGEND_COLORS[LEGEND_COLORS.length - 1] ?? '#059669'

interface LegendBin {
  min: number
  max: number
  color: string
}

const buildLegendBins = (values: number[], binCount: number = LEGEND_COLORS.length): LegendBin[] => {
  if (values.length === 0) {
    return [
      {
        min: 0,
        max: 100,
        color: colorAt(LEGEND_COLORS.length - 1),
      },
    ]
  }

  const min = Math.min(...values)
  const max = Math.max(...values)

  if (Math.abs(max - min) < 0.001) {
    return [
      {
        min,
        max,
        color: colorAt(LEGEND_COLORS.length - 1),
      },
    ]
  }

  const safeBinCount = Math.max(3, Math.min(binCount, LEGEND_COLORS.length))
  const step = (max - min) / safeBinCount

  return Array.from({ length: safeBinCount }, (_, index) => {
    const start = min + index * step
    const end = index === safeBinCount - 1 ? max : min + (index + 1) * step
    return {
      min: start,
      max: end,
      color: colorAt(index),
    }
  })
}

const colorForValue = (value: number, bins: LegendBin[]): string => {
  for (const [index, bin] of bins.entries()) {
    const isLast = index === bins.length - 1
    if (value >= bin.min && (value < bin.max || isLast)) {
      return bin.color
    }
  }

  return bins[bins.length - 1]?.color ?? '#059669'
}

interface MicroAreaMapProps {
  areas: DerivedMicroArea[]
  metric: ColorMetric
}

export const MicroAreaMap = ({ areas, metric }: MicroAreaMapProps) => {
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const values = useMemo(
    () =>
      areas.map((area) =>
        metric === 'overall' ? area.dynamicOverallScore : area.componentScores[metric],
      ),
    [areas, metric],
  )

  const legendBins = useMemo(() => buildLegendBins(values), [values])

  const center = useMemo(() => {
    if (areas.length === 0) {
      return [51.594, -0.381] as [number, number]
    }

    const lat = areas.reduce((sum, area) => sum + area.centroid.lat, 0) / areas.length
    const lon = areas.reduce((sum, area) => sum + area.centroid.lon, 0) / areas.length

    return [lat, lon] as [number, number]
  }, [areas])

  const selected = selectedId
    ? (areas.find((area) => area.microAreaId === selectedId) ?? null)
    : null

  return (
    <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
      <div className="h-[560px] overflow-hidden rounded-2xl border border-teal-100 bg-white shadow-panel">
        <MapContainer center={center} zoom={11} scrollWheelZoom className="h-full w-full">
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          {areas.map((area) => {
            const score =
              metric === 'overall' ? area.dynamicOverallScore : area.componentScores[metric]
            const color = colorForValue(score, legendBins)
            return (
              <Circle
                key={area.microAreaId}
                center={[area.centroid.lat, area.centroid.lon]}
                radius={area.catchment.radiusMeters}
                pathOptions={{
                  color,
                  fillColor: color,
                  fillOpacity: 0.3,
                  weight: 1.5,
                }}
                eventHandlers={{
                  click: () => setSelectedId(area.microAreaId),
                }}
              >
                <Popup>
                  <div className="text-sm">
                    <p className="font-semibold">{area.stationName}</p>
                    <p>Score: {area.dynamicOverallScore.toFixed(1)}</p>
                    <p>Commute: {formatNumber(area.commuteTypicalMinutes.value)} min</p>
                  </div>
                </Popup>
              </Circle>
            )
          })}

          {areas.map((area) => (
            <Marker
              key={`${area.microAreaId}-marker`}
              position={[area.centroid.lat, area.centroid.lon]}
            />
          ))}
        </MapContainer>
      </div>

      <aside className="rounded-2xl border border-teal-100 bg-white p-4 shadow-panel">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-700">Map legend</h3>
        <p className="mt-1 text-sm text-slate-600">Colour scale: {mapMetricLabel[metric]}</p>
        {values.length > 0 ? (
          <p className="mt-1 text-xs text-slate-500">
            Range in current view: {formatNumber(Math.min(...values), 1)} -{' '}
            {formatNumber(Math.max(...values), 1)}
          </p>
        ) : null}
        <ul className="mt-3 space-y-1 text-xs text-slate-700">
          {legendBins.map((bin, index) => {
            const isLast = index === legendBins.length - 1
            return (
              <li key={`${bin.min}-${bin.max}`}>
                <span className="inline-block h-3 w-3 rounded-full" style={{ backgroundColor: bin.color }} />{' '}
                {formatNumber(bin.min, 1)} - {isLast ? formatNumber(bin.max, 1) : formatNumber(bin.max, 1)}
              </li>
            )
          })}
        </ul>

        {selected ? (
          <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
            <p className="font-semibold">{selected.stationName}</p>
            <p>Overall score: {selected.dynamicOverallScore.toFixed(1)}</p>
            <p>Median semi: {formatCurrency(selected.medianSemiDetachedPrice.value)}</p>
            <p>Commute: {formatNumber(selected.commuteTypicalMinutes.value)} min</p>
            <p>Drive to Pinner: {formatNumber(selected.driveTimeToPinnerMinutes.value)} min</p>
            <Link
              to={`/micro-area/${selected.microAreaId}`}
              className="mt-2 inline-block text-surge hover:underline"
            >
              Open full details
            </Link>
          </div>
        ) : (
          <p className="mt-5 text-sm text-slate-500">
            Click a micro-area on the map to inspect details.
          </p>
        )}
      </aside>
    </div>
  )
}
