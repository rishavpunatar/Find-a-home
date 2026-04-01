import 'leaflet/dist/leaflet.css'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import L from 'leaflet'
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png'
import markerIcon from 'leaflet/dist/images/marker-icon.png'
import markerShadow from 'leaflet/dist/images/marker-shadow.png'
import {
  Circle,
  MapContainer,
  Marker,
  Popup,
  TileLayer,
  useMapEvents,
} from 'react-leaflet'

import type { ComponentScores, Coordinate, DerivedMicroArea } from '@/types/domain'

import { AreaTrustSummary } from '@/components/AreaTrustSummary'
import { formatCurrency, formatNumber } from '@/lib/format'

L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
})

export type ColorMetric = 'overall' | keyof ComponentScores

export interface MapViewport {
  lat: number
  lon: number
  zoom: number
}

const mapMetricLabel: Record<ColorMetric, string> = {
  overall: 'Overall score',
  value: 'Value score',
  transport: 'Transport score',
  schools: 'School score',
  environment: 'Environment score',
  crime: 'Crime score',
  proximity: 'Pinner access score',
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

interface MarkerCluster {
  lat: number
  lon: number
  members: DerivedMicroArea[]
}

const buildRangeLegendBins = (values: number[], binCount: number = LEGEND_COLORS.length): LegendBin[] => {
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

const percentileValue = (sortedValues: number[], percentile: number): number => {
  if (sortedValues.length === 0) {
    return 0
  }
  const clamped = Math.max(0, Math.min(1, percentile))
  const index = clamped * (sortedValues.length - 1)
  const lower = Math.floor(index)
  const upper = Math.ceil(index)
  if (lower === upper) {
    return sortedValues[lower] ?? sortedValues[sortedValues.length - 1] ?? 0
  }
  const lowerValue = sortedValues[lower] ?? 0
  const upperValue = sortedValues[upper] ?? lowerValue
  const fraction = index - lower
  return lowerValue + (upperValue - lowerValue) * fraction
}

const buildQuantileLegendBins = (values: number[], binCount: number = LEGEND_COLORS.length): LegendBin[] => {
  if (values.length === 0) {
    return [
      {
        min: 0,
        max: 100,
        color: colorAt(LEGEND_COLORS.length - 1),
      },
    ]
  }

  const sortedValues = [...values].sort((left, right) => left - right)
  const safeBinCount = Math.max(3, Math.min(binCount, LEGEND_COLORS.length))
  const bins: LegendBin[] = []

  for (let index = 0; index < safeBinCount; index += 1) {
    const start = percentileValue(sortedValues, index / safeBinCount)
    const end = percentileValue(sortedValues, (index + 1) / safeBinCount)
    const previousMax = bins[index - 1]?.max ?? start
    bins.push({
      min: index === 0 ? start : Math.max(start, previousMax),
      max:
        index === safeBinCount - 1
          ? sortedValues[sortedValues.length - 1] ?? end
          : Math.max(end, start),
      color: colorAt(index),
    })
  }

  return bins
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

const haversineDistanceM = (left: Coordinate, right: Coordinate): number => {
  const radiusM = 6_371_000
  const lat1 = (left.lat * Math.PI) / 180
  const lon1 = (left.lon * Math.PI) / 180
  const lat2 = (right.lat * Math.PI) / 180
  const lon2 = (right.lon * Math.PI) / 180
  const dLat = lat2 - lat1
  const dLon = lon2 - lon1
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return radiusM * 2 * Math.asin(Math.sqrt(h))
}

const buildMarkerClusters = (areas: DerivedMicroArea[], clusterRadiusM = 650): MarkerCluster[] => {
  const clusters: MarkerCluster[] = []

  for (const area of areas) {
    let bestClusterIndex = -1
    let bestDistance = Number.POSITIVE_INFINITY

    for (let index = 0; index < clusters.length; index += 1) {
      const cluster = clusters[index]
      if (!cluster) {
        continue
      }
      const distance = haversineDistanceM(area.centroid, {
        lat: cluster.lat,
        lon: cluster.lon,
      })
      if (distance <= clusterRadiusM && distance < bestDistance) {
        bestDistance = distance
        bestClusterIndex = index
      }
    }

    if (bestClusterIndex === -1) {
      clusters.push({
        lat: area.centroid.lat,
        lon: area.centroid.lon,
        members: [area],
      })
      continue
    }

    const targetCluster = clusters[bestClusterIndex]
    if (!targetCluster) {
      continue
    }
    targetCluster.members.push(area)
    const count = targetCluster.members.length
    targetCluster.lat = (targetCluster.lat * (count - 1) + area.centroid.lat) / count
    targetCluster.lon = (targetCluster.lon * (count - 1) + area.centroid.lon) / count
  }

  return clusters
}

const clusterIcon = (count: number) =>
  L.divIcon({
    className: '',
    html: `<div style="
      height:34px;
      width:34px;
      border-radius:17px;
      background:#0f766e;
      color:#fff;
      border:2px solid #fff;
      box-shadow:0 2px 8px rgba(0,0,0,0.25);
      display:flex;
      align-items:center;
      justify-content:center;
      font-weight:700;
      font-size:12px;
      line-height:1;
    ">${count}</div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  })

const MapInteractionBridge = ({
  onViewportChange,
  focusCoordinate,
}: {
  onViewportChange?: (viewport: MapViewport) => void
  focusCoordinate?: Coordinate | null
}) => {
  const lastFocusKeyRef = useRef<string>('')
  const map = useMapEvents({
    moveend: () => {
      const center = map.getCenter()
      onViewportChange?.({
        lat: center.lat,
        lon: center.lng,
        zoom: map.getZoom(),
      })
    },
    zoomend: () => {
      const center = map.getCenter()
      onViewportChange?.({
        lat: center.lat,
        lon: center.lng,
        zoom: map.getZoom(),
      })
    },
  })

  useEffect(() => {
    if (!focusCoordinate) {
      return
    }

    const focusKey = `${focusCoordinate.lat.toFixed(6)}:${focusCoordinate.lon.toFixed(6)}`
    if (lastFocusKeyRef.current === focusKey) {
      return
    }

    lastFocusKeyRef.current = focusKey
    map.flyTo([focusCoordinate.lat, focusCoordinate.lon], Math.max(12, map.getZoom()), {
      animate: true,
      duration: 0.65,
    })
  }, [focusCoordinate, map])

  return null
}

interface MicroAreaMapProps {
  areas: DerivedMicroArea[]
  metric: ColorMetric
  selectedAreaId?: string | null
  hoveredAreaId?: string | null
  onSelectArea?: (id: string) => void
  onHoverArea?: (id: string | null) => void
  focusAreaId?: string | null
  initialCenter?: [number, number]
  initialZoom?: number
  showMarkers?: boolean
  onShowMarkersChange?: (next: boolean) => void
  onViewportChange?: (viewport: MapViewport) => void
}

const componentScoreRows: Array<{ key: keyof ComponentScores; label: string }> = [
  { key: 'value', label: 'Value' },
  { key: 'transport', label: 'Transport' },
  { key: 'schools', label: 'Schools' },
  { key: 'environment', label: 'Environment' },
  { key: 'crime', label: 'Crime' },
  { key: 'proximity', label: 'Pinner' },
  { key: 'planningRisk', label: 'Planning' },
]

const MapDetailContent = ({
  area,
  fromPath,
  hoverMode = false,
}: {
  area: DerivedMicroArea
  fromPath: string
  hoverMode?: boolean
}) => (
  <div className="text-sm">
    <p className="font-semibold text-slate-900">{area.stationName}</p>
    <p className="text-xs text-slate-600">
      {area.localAuthority}, {area.countyOrBorough}
    </p>
    <div className="mt-2 grid gap-2 sm:grid-cols-2">
      <div className="rounded-md bg-slate-50 px-2 py-1.5">
        <p className="text-[11px] uppercase tracking-wide text-slate-500">Overall</p>
        <p className="font-semibold text-slate-900">{area.dynamicOverallScore.toFixed(1)}</p>
      </div>
      <div className="rounded-md bg-slate-50 px-2 py-1.5">
        <p className="text-[11px] uppercase tracking-wide text-slate-500">Confidence</p>
        <p className="font-semibold text-slate-900">
          {formatNumber(area.dataConfidenceScore * 100, 0)}%
        </p>
      </div>
      <div className="rounded-md bg-slate-50 px-2 py-1.5">
        <p className="text-[11px] uppercase tracking-wide text-slate-500">Median Semi</p>
        <p className="font-semibold text-slate-900">
          {formatCurrency(area.medianSemiDetachedPrice.value)}
        </p>
      </div>
      <div className="rounded-md bg-slate-50 px-2 py-1.5">
        <p className="text-[11px] uppercase tracking-wide text-slate-500">Commute</p>
        <p className="font-semibold text-slate-900">
          {formatNumber(area.commuteTypicalMinutes.value)} min
        </p>
      </div>
      <div className="rounded-md bg-slate-50 px-2 py-1.5">
        <p className="text-[11px] uppercase tracking-wide text-slate-500">PM2.5</p>
        <p className="font-semibold text-slate-900">{formatNumber(area.annualPm25.value, 1)}</p>
      </div>
      <div className="rounded-md bg-slate-50 px-2 py-1.5">
        <p className="text-[11px] uppercase tracking-wide text-slate-500">Green Cover</p>
        <p className="font-semibold text-slate-900">
          {formatNumber(area.greenCoverPct.value, 1)}%
        </p>
      </div>
    </div>
    <div className="mt-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        Score breakdown
      </p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {componentScoreRows.map((row) => (
          <div key={row.key} className="rounded-md border border-slate-200 px-2 py-1.5">
            <p className="text-[11px] uppercase tracking-wide text-slate-500">{row.label}</p>
            <p className="font-medium text-slate-900">
              {formatNumber(area.componentScores[row.key], 1)}
            </p>
          </div>
        ))}
      </div>
    </div>
    <div className="mt-3">
      <AreaTrustSummary area={area} compact />
    </div>
    {!hoverMode ? (
      <Link
        to={`/micro-area/${area.microAreaId}`}
        state={{ from: fromPath }}
        className="mt-2 inline-block text-surge hover:underline"
      >
        Open full details
      </Link>
    ) : null}
  </div>
)

export const MicroAreaMap = ({
  areas,
  metric,
  selectedAreaId,
  hoveredAreaId,
  onSelectArea,
  onHoverArea,
  focusAreaId,
  initialCenter,
  initialZoom = 11,
  showMarkers,
  onShowMarkersChange,
  onViewportChange,
}: MicroAreaMapProps) => {
  const location = useLocation()
  const [internalSelectedId, setInternalSelectedId] = useState<string | null>(null)
  const [internalHoveredId, setInternalHoveredId] = useState<string | null>(null)
  const [legendMode, setLegendMode] = useState<'quantile' | 'range'>('quantile')
  const [internalShowMarkers, setInternalShowMarkers] = useState(true)

  const values = useMemo(
    () =>
      areas.map((area) =>
        metric === 'overall' ? area.dynamicOverallScore : area.componentScores[metric],
      ),
    [areas, metric],
  )

  const legendBins = useMemo(
    () =>
      legendMode === 'quantile' ? buildQuantileLegendBins(values) : buildRangeLegendBins(values),
    [legendMode, values],
  )
  const denseLayer = areas.length > 250

  const fallbackCenter = useMemo(() => {
    if (areas.length === 0) {
      return [51.594, -0.381] as [number, number]
    }

    const lat = areas.reduce((sum, area) => sum + area.centroid.lat, 0) / areas.length
    const lon = areas.reduce((sum, area) => sum + area.centroid.lon, 0) / areas.length

    return [lat, lon] as [number, number]
  }, [areas])

  const mapCenter = initialCenter ?? fallbackCenter
  const currentSelectedId = selectedAreaId ?? internalSelectedId
  const currentHoveredId = hoveredAreaId ?? internalHoveredId
  const markerLayerVisible = showMarkers ?? internalShowMarkers
  const fromPath = `${location.pathname}${location.search}`

  const selected = currentSelectedId
    ? (areas.find((area) => area.microAreaId === currentSelectedId) ?? null)
    : null

  const focusCoordinate = focusAreaId
    ? (areas.find((area) => area.microAreaId === focusAreaId)?.centroid ?? null)
    : null
  const hovered = currentHoveredId
    ? (areas.find((area) => area.microAreaId === currentHoveredId) ?? null)
    : null
  const inspected = hovered ?? selected

  const markerClusters = useMemo(() => buildMarkerClusters(areas), [areas])

  const setSelected = (id: string) => {
    onSelectArea?.(id)
    if (selectedAreaId === undefined) {
      setInternalSelectedId(id)
    }
  }

  const setHovered = (id: string | null) => {
    onHoverArea?.(id)
    if (hoveredAreaId === undefined) {
      setInternalHoveredId(id)
    }
  }

  const toggleMarkers = () => {
    const next = !markerLayerVisible
    onShowMarkersChange?.(next)
    if (showMarkers === undefined) {
      setInternalShowMarkers(next)
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
      <div className="h-[560px] overflow-hidden rounded-2xl border border-teal-100 bg-white shadow-panel">
        <MapContainer center={mapCenter} zoom={initialZoom} scrollWheelZoom className="h-full w-full">
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          <MapInteractionBridge
            {...(onViewportChange ? { onViewportChange } : {})}
            focusCoordinate={focusCoordinate}
          />

          {areas.map((area) => {
            const score =
              metric === 'overall' ? area.dynamicOverallScore : area.componentScores[metric]
            const color = colorForValue(score, legendBins)
            const isSelected = area.microAreaId === currentSelectedId
            const isHovered = area.microAreaId === currentHoveredId

            return (
              <Circle
                key={area.microAreaId}
                center={[area.centroid.lat, area.centroid.lon]}
                radius={area.catchment.radiusMeters}
                pathOptions={{
                  color,
                  fillColor: color,
                  fillOpacity: isSelected ? 0.48 : isHovered ? 0.38 : 0.3,
                  weight: isSelected ? 3 : isHovered ? 2.2 : 1.5,
                  opacity: isSelected ? 1 : 0.85,
                }}
                eventHandlers={{
                  click: () => setSelected(area.microAreaId),
                  mouseover: () => setHovered(area.microAreaId),
                  mouseout: () => setHovered(null),
                }}
              >
                <Popup>
                  <MapDetailContent area={area} fromPath={fromPath} />
                </Popup>
              </Circle>
            )
          })}

          {markerLayerVisible
            ? denseLayer
              ? markerClusters.map((cluster, index) => {
                  if (cluster.members.length === 1) {
                    const [area] = cluster.members
                    if (!area) {
                      return null
                    }
                    return (
                      <Marker
                        key={`${area.microAreaId}-marker`}
                        position={[area.centroid.lat, area.centroid.lon]}
                        eventHandlers={{
                          click: () => setSelected(area.microAreaId),
                          mouseover: () => setHovered(area.microAreaId),
                          mouseout: () => setHovered(null),
                        }}
                      >
                        <Popup>
                          <MapDetailContent area={area} fromPath={fromPath} />
                        </Popup>
                      </Marker>
                    )
                  }

                  return (
                    <Marker
                      key={`cluster-${index}-${cluster.members.length}`}
                      position={[cluster.lat, cluster.lon]}
                      icon={clusterIcon(cluster.members.length)}
                      eventHandlers={{
                        click: () => {
                          const first = cluster.members[0]
                          if (first) {
                            setSelected(first.microAreaId)
                          }
                        },
                      }}
                    >
                      <Popup>
                        <div className="text-sm">
                          <p className="font-semibold">
                            {cluster.members.length} areas in this cluster
                          </p>
                          <ul className="mt-2 max-h-36 space-y-1 overflow-auto text-xs">
                            {cluster.members.slice(0, 12).map((member) => (
                              <li key={member.microAreaId}>
                                <button
                                  type="button"
                                  onClick={() => setSelected(member.microAreaId)}
                                  className="text-surge hover:underline"
                                >
                                  {member.stationName}
                                </button>
                              </li>
                            ))}
                            {cluster.members.length > 12 ? (
                              <li className="text-slate-500">
                                +{cluster.members.length - 12} more
                              </li>
                            ) : null}
                          </ul>
                        </div>
                      </Popup>
                    </Marker>
                  )
                })
              : areas.map((area) => (
                  <Marker
                    key={`${area.microAreaId}-marker`}
                    position={[area.centroid.lat, area.centroid.lon]}
                    eventHandlers={{
                      click: () => setSelected(area.microAreaId),
                      mouseover: () => setHovered(area.microAreaId),
                      mouseout: () => setHovered(null),
                    }}
                  >
                    <Popup>
                      <MapDetailContent area={area} fromPath={fromPath} />
                    </Popup>
                  </Marker>
                ))
            : null}
        </MapContainer>
      </div>

      <aside className="rounded-2xl border border-teal-100 bg-white p-4 shadow-panel">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-700">Map legend</h3>
        <p className="mt-1 text-sm text-slate-600">Colour scale: {mapMetricLabel[metric]}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setLegendMode('quantile')}
            className={`rounded-md px-2 py-1 text-xs ${
              legendMode === 'quantile' ? 'bg-teal-600 text-white' : 'bg-slate-100 text-slate-700'
            }`}
          >
            Quantile bins
          </button>
          <button
            type="button"
            onClick={() => setLegendMode('range')}
            className={`rounded-md px-2 py-1 text-xs ${
              legendMode === 'range' ? 'bg-teal-600 text-white' : 'bg-slate-100 text-slate-700'
            }`}
          >
            Equal-range bins
          </button>
          <button
            type="button"
            onClick={toggleMarkers}
            className="rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-700"
          >
            {markerLayerVisible ? 'Hide blue teardrop pins' : 'Show blue teardrop pins'}
          </button>
        </div>
        {values.length > 0 ? (
          <p className="mt-1 text-xs text-slate-500">
            Range in current view: {formatNumber(Math.min(...values), 1)} -{' '}
            {formatNumber(Math.max(...values), 1)}
          </p>
        ) : null}
        <p className="mt-2 text-xs text-slate-600">
          {legendMode === 'quantile'
            ? 'Quantile bins keep roughly the same number of areas in each colour bucket, which is useful for seeing relative ranking even when values are tightly clustered.'
            : 'Equal-range bins split the full numeric range into equal value steps, which is better when you want the colours to reflect absolute differences in the metric itself.'}
        </p>
        {denseLayer && markerLayerVisible ? (
          <p className="mt-1 text-xs text-slate-500">
            Marker clustering active ({markerClusters.length} clusters across {areas.length} areas).
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

        {inspected ? (
          <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              {hovered ? 'Hovered area' : 'Selected area'}
            </p>
            <MapDetailContent area={inspected} fromPath={fromPath} hoverMode />
          </div>
        ) : (
          <p className="mt-5 text-sm text-slate-500">
            Hover a catchment circle or blue pin to inspect score details. Click to keep an area
            selected.
          </p>
        )}
      </aside>
    </div>
  )
}
