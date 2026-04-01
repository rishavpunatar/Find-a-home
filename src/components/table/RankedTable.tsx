import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'

import type { DerivedMicroArea, SortConfig } from '@/types/domain'

import { AreaTrustSummary } from '@/components/AreaTrustSummary'
import {
  getAreaPropertyEvidenceLabel,
  isSourceAppliedProvenance,
} from '@/lib/dataQuality'
import { formatCurrency, formatNumber } from '@/lib/format'

interface RankedTableProps {
  areas: DerivedMicroArea[]
  pinnedIds: string[]
  onTogglePin: (id: string) => void
}

const ROW_HEIGHT = 96
const OVERSCAN_ROWS = 10

const getSortValue = (area: DerivedMicroArea, key: string): number | string => {
  switch (key) {
    case 'station':
      return area.stationName
    case 'score':
      return area.dynamicOverallScore
    case 'commute':
      return area.commuteTypicalMinutes.value ?? Number.POSITIVE_INFINITY
    case 'drive':
      return area.driveTimeToPinnerMinutes.value ?? Number.POSITIVE_INFINITY
    case 'price':
      return area.medianSemiDetachedPrice.value ?? Number.POSITIVE_INFINITY
    case 'schools':
      return area.componentScores.schools
    case 'qol':
      return area.boroughQolScore.value ?? Number.NEGATIVE_INFINITY
    case 'pm25':
      return area.annualPm25.value ?? Number.POSITIVE_INFINITY
    case 'crime':
      return area.crimeRatePerThousand.value ?? Number.POSITIVE_INFINITY
    case 'green':
      return area.greenCoverPct.value ?? 0
    case 'confidence':
      return area.dataConfidenceScore
    default:
      return area.dynamicOverallScore
  }
}

const sortRows = (areas: DerivedMicroArea[], config: SortConfig): DerivedMicroArea[] => {
  const sorted = [...areas]

  sorted.sort((a, b) => {
    const left = getSortValue(a, config.key)
    const right = getSortValue(b, config.key)

    if (typeof left === 'string' && typeof right === 'string') {
      return config.direction === 'asc' ? left.localeCompare(right) : right.localeCompare(left)
    }

    const leftValue = typeof left === 'number' ? left : 0
    const rightValue = typeof right === 'number' ? right : 0

    return config.direction === 'asc' ? leftValue - rightValue : rightValue - leftValue
  })

  return sorted
}

const HeaderCell = ({
  label,
  sortKey,
  current,
  onSort,
  helpText,
}: {
  label: string
  sortKey: string
  current: SortConfig
  onSort: (sortKey: string) => void
  helpText?: string
}) => (
  <th
    aria-sort={
      current.key === sortKey ? (current.direction === 'asc' ? 'ascending' : 'descending') : 'none'
    }
    className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-600"
  >
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      className="inline-flex items-center gap-1"
    >
      {label}
      {current.key === sortKey ? <span>{current.direction === 'asc' ? '↑' : '↓'}</span> : null}
    </button>
    {helpText ? (
      <span
        className="ml-1 cursor-help rounded-full border border-slate-300 px-1 text-[10px] font-semibold text-slate-500"
        title={helpText}
        aria-label={helpText}
      >
        i
      </span>
    ) : null}
  </th>
)

export const RankedTable = ({
  areas,
  pinnedIds,
  onTogglePin,
}: RankedTableProps) => {
  const location = useLocation()
  const [sort, setSort] = useState<SortConfig>({ key: 'score', direction: 'desc' })
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(560)
  const [searchTerm, setSearchTerm] = useState('')
  const [maxPriceFilter, setMaxPriceFilter] = useState('')
  const [maxCommuteFilter, setMaxCommuteFilter] = useState('')
  const [minSchoolFilter, setMinSchoolFilter] = useState('')
  const [pinnedOnly, setPinnedOnly] = useState(false)
  const [sourceBackedPriceOnly, setSourceBackedPriceOnly] = useState(false)
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const deferredSearchTerm = useDeferredValue(searchTerm)

  const locallyFilteredRows = useMemo(() => {
    const normalizedSearch = deferredSearchTerm.trim().toLowerCase()
    const maxPrice = Number(maxPriceFilter)
    const maxCommute = Number(maxCommuteFilter)
    const minSchool = Number(minSchoolFilter)

    return areas.filter((area) => {
      if (pinnedOnly && !pinnedIds.includes(area.microAreaId)) {
        return false
      }

      if (
        sourceBackedPriceOnly &&
        !isSourceAppliedProvenance(area.medianSemiDetachedPrice.provenance)
      ) {
        return false
      }

      if (normalizedSearch) {
        const haystack = [
          area.stationName,
          area.localAuthority,
          area.countyOrBorough,
        ]
          .join(' ')
          .toLowerCase()
        if (!haystack.includes(normalizedSearch)) {
          return false
        }
      }

      if (maxPriceFilter && (area.medianSemiDetachedPrice.value ?? Number.POSITIVE_INFINITY) > maxPrice) {
        return false
      }

      if (maxCommuteFilter && (area.commuteTypicalMinutes.value ?? Number.POSITIVE_INFINITY) > maxCommute) {
        return false
      }

      if (minSchoolFilter && area.componentScores.schools < minSchool) {
        return false
      }

      return true
    })
  }, [
    areas,
    deferredSearchTerm,
    maxCommuteFilter,
    maxPriceFilter,
    minSchoolFilter,
    pinnedIds,
    pinnedOnly,
    sourceBackedPriceOnly,
  ])
  const sortedRows = useMemo(() => sortRows(locallyFilteredRows, sort), [locallyFilteredRows, sort])
  const fromPath = `${location.pathname}${location.search}`

  useEffect(() => {
    const updateHeight = () => {
      setViewportHeight(scrollContainerRef.current?.clientHeight ?? 560)
    }

    updateHeight()
    window.addEventListener('resize', updateHeight)
    return () => window.removeEventListener('resize', updateHeight)
  }, [])

  useEffect(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0
    }
  }, [
    locallyFilteredRows.length,
    pinnedOnly,
    sourceBackedPriceOnly,
    searchTerm,
    maxPriceFilter,
    maxCommuteFilter,
    minSchoolFilter,
    sort.direction,
    sort.key,
  ])

  const toggleSort = (key: string) => {
    setSort((current) => {
      if (current.key !== key) {
        return { key, direction: 'desc' }
      }

      return {
        key,
        direction: current.direction === 'desc' ? 'asc' : 'desc',
      }
    })
  }

  if (areas.length === 0) {
    return (
      <p className="rounded-xl bg-white p-4 text-sm text-slate-700">
        No micro-areas match current filters.
      </p>
    )
  }

  const visibleRowCount = Math.ceil(viewportHeight / ROW_HEIGHT) + OVERSCAN_ROWS * 2
  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN_ROWS)
  const endIndex = Math.min(sortedRows.length, startIndex + visibleRowCount)
  const visibleRows = sortedRows.slice(startIndex, endIndex)
  const topSpacerHeight = startIndex * ROW_HEIGHT
  const bottomSpacerHeight = Math.max(0, (sortedRows.length - endIndex) * ROW_HEIGHT)

  return (
    <div className="overflow-x-auto rounded-2xl border border-teal-100 bg-white shadow-panel">
      <div className="border-b border-teal-100 bg-teal-50/80 px-4 py-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-[220px] flex-1 flex-col gap-1 text-xs font-medium text-slate-600">
            Search station or borough
            <input
              type="text"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Ealing, Wimbledon, Harrow..."
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
            />
          </label>
          <label className="flex w-36 flex-col gap-1 text-xs font-medium text-slate-600">
            Max price
            <input
              type="number"
              min="0"
              step="5000"
              value={maxPriceFilter}
              onChange={(event) => setMaxPriceFilter(event.target.value)}
              placeholder="Any"
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
            />
          </label>
          <label className="flex w-32 flex-col gap-1 text-xs font-medium text-slate-600">
            Max commute
            <input
              type="number"
              min="0"
              step="1"
              value={maxCommuteFilter}
              onChange={(event) => setMaxCommuteFilter(event.target.value)}
              placeholder="Any"
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
            />
          </label>
          <label className="flex w-32 flex-col gap-1 text-xs font-medium text-slate-600">
            Min school
            <input
              type="number"
              min="0"
              max="100"
              step="1"
              value={minSchoolFilter}
              onChange={(event) => setMinSchoolFilter(event.target.value)}
              placeholder="Any"
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
            />
          </label>
          <label className="flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={sourceBackedPriceOnly}
              onChange={(event) => setSourceBackedPriceOnly(event.target.checked)}
            />
            Source-backed price only
          </label>
          <label className="flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={pinnedOnly}
              onChange={(event) => setPinnedOnly(event.target.checked)}
            />
            Pinned only
          </label>
          <button
            type="button"
            onClick={() => {
              setSearchTerm('')
              setMaxPriceFilter('')
              setMaxCommuteFilter('')
              setMinSchoolFilter('')
              setSourceBackedPriceOnly(false)
              setPinnedOnly(false)
            }}
            className="rounded-md bg-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-300"
          >
            Reset table filters
          </button>
        </div>
        <p className="mt-2 text-xs text-slate-600">
          Showing <span className="font-semibold">{locallyFilteredRows.length}</span> of{' '}
          <span className="font-semibold">{areas.length}</span> rows in this table view.
        </p>
      </div>
      <div
        ref={scrollContainerRef}
        className="max-h-[72vh] overflow-y-auto"
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      >
        <table className="min-w-full divide-y divide-teal-100">
          <thead className="sticky top-0 z-10 bg-teal-50">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                Rank
              </th>
              <HeaderCell label="Station" sortKey="station" current={sort} onSort={toggleSort} />
              <HeaderCell label="Score" sortKey="score" current={sort} onSort={toggleSort} />
              <HeaderCell label="Commute" sortKey="commute" current={sort} onSort={toggleSort} />
              <HeaderCell label="Drive" sortKey="drive" current={sort} onSort={toggleSort} />
              <HeaderCell label="Median price" sortKey="price" current={sort} onSort={toggleSort} />
              <HeaderCell label="School" sortKey="schools" current={sort} onSort={toggleSort} />
              <HeaderCell label="QoL" sortKey="qol" current={sort} onSort={toggleSort} />
              <HeaderCell label="PM2.5" sortKey="pm25" current={sort} onSort={toggleSort} />
              <HeaderCell label="Crime" sortKey="crime" current={sort} onSort={toggleSort} />
              <HeaderCell label="Green" sortKey="green" current={sort} onSort={toggleSort} />
              <HeaderCell
                label="Confidence"
                sortKey="confidence"
                current={sort}
                onSort={toggleSort}
                helpText="Confidence is dataConfidenceScore x 100. It blends metric-level confidence and catchment overlap confidence."
              />
              <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                Actions
              </th>
            </tr>
          </thead>

          <tbody className="divide-y divide-teal-50 text-sm">
            {topSpacerHeight > 0 ? (
              <tr aria-hidden>
                <td colSpan={13} style={{ height: topSpacerHeight }} />
              </tr>
            ) : null}

            {visibleRows.map((area, index) => {
              const isPinned = pinnedIds.includes(area.microAreaId)
              const propertyEvidence = getAreaPropertyEvidenceLabel(area)

              return (
                <tr key={area.microAreaId} className="h-[96px] hover:bg-teal-50/50">
                  <td className="px-3 py-2 font-medium text-slate-700">{startIndex + index + 1}</td>
                  <td className="px-3 py-2">
                    <Link
                      to={`/micro-area/${area.microAreaId}`}
                      state={{ from: fromPath }}
                      className="font-semibold text-surge hover:underline"
                    >
                      {area.stationName}
                    </Link>
                    <div className="text-xs text-slate-500">{area.localAuthority}</div>
                    <div className="mt-1 inline-flex rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-600">
                      Price evidence: {propertyEvidence}
                    </div>
                    <div className="mt-1">
                      <AreaTrustSummary area={area} compact />
                    </div>
                  </td>
                  <td className="px-3 py-2 font-semibold">{area.dynamicOverallScore.toFixed(1)}</td>
                  <td className="px-3 py-2">{formatNumber(area.commuteTypicalMinutes.value)} min</td>
                  <td className="px-3 py-2">
                    {formatNumber(area.driveTimeToPinnerMinutes.value)} min
                  </td>
                  <td className="px-3 py-2">{formatCurrency(area.medianSemiDetachedPrice.value)}</td>
                  <td className="px-3 py-2">{area.componentScores.schools.toFixed(1)}</td>
                  <td className="px-3 py-2">{formatNumber(area.boroughQolScore.value, 1)}</td>
                  <td className="px-3 py-2">{formatNumber(area.annualPm25.value, 1)}</td>
                  <td className="px-3 py-2">{formatNumber(area.crimeRatePerThousand.value, 1)}</td>
                  <td className="px-3 py-2">{formatNumber(area.greenCoverPct.value, 1)}%</td>
                  <td className="px-3 py-2">{(area.dataConfidenceScore * 100).toFixed(0)}%</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className={`rounded-md px-2 py-1 text-xs ${
                          isPinned ? 'bg-amber-100 text-amber-900' : 'bg-slate-100 text-slate-700'
                        }`}
                        onClick={() => onTogglePin(area.microAreaId)}
                      >
                        {isPinned ? 'Pinned' : 'Pin'}
                      </button>
                      <Link
                        to={`/filtered?sel=${area.microAreaId}#filtered-map`}
                        className="rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-700 hover:bg-slate-200"
                      >
                        Map
                      </Link>
                    </div>
                  </td>
                </tr>
              )
            })}

            {bottomSpacerHeight > 0 ? (
              <tr aria-hidden>
                <td colSpan={13} style={{ height: bottomSpacerHeight }} />
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="border-t border-teal-100 bg-teal-50 px-4 py-2 text-xs text-slate-600">
        <span className="font-semibold">Confidence guide:</span> 80-100% high reliability, 60-79%
        moderate, below 60% lower-confidence estimates or partial-source metrics.
      </div>
    </div>
  )
}
