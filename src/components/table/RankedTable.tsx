import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import type { DerivedMicroArea, SortConfig } from '@/types/domain'

import { formatCurrency, formatNumber } from '@/lib/format'

interface RankedTableProps {
  areas: DerivedMicroArea[]
  pinnedIds: string[]
  compareIds: string[]
  onTogglePin: (id: string) => void
  onToggleCompare: (id: string) => void
}

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
}: {
  label: string
  sortKey: string
  current: SortConfig
  onSort: (sortKey: string) => void
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
  </th>
)

export const RankedTable = ({
  areas,
  pinnedIds,
  compareIds,
  onTogglePin,
  onToggleCompare,
}: RankedTableProps) => {
  const [sort, setSort] = useState<SortConfig>({ key: 'score', direction: 'desc' })

  const sortedRows = useMemo(() => sortRows(areas, sort), [areas, sort])

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

  return (
    <div className="overflow-x-auto rounded-2xl border border-teal-100 bg-white shadow-panel">
      <table className="min-w-full divide-y divide-teal-100">
        <thead className="bg-teal-50">
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
            />
            <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
              Actions
            </th>
          </tr>
        </thead>

        <tbody className="divide-y divide-teal-50 text-sm">
          {sortedRows.map((area) => {
            const isPinned = pinnedIds.includes(area.microAreaId)
            const isCompared = compareIds.includes(area.microAreaId)

            return (
              <tr key={area.microAreaId} className="hover:bg-teal-50/50">
                <td className="px-3 py-2 font-medium text-slate-700">{area.overallRank}</td>
                <td className="px-3 py-2">
                  <Link
                    to={`/micro-area/${area.microAreaId}`}
                    className="font-semibold text-surge hover:underline"
                  >
                    {area.stationName}
                  </Link>
                  <div className="text-xs text-slate-500">{area.localAuthority}</div>
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
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className={`rounded-md px-2 py-1 text-xs ${
                        isPinned ? 'bg-amber-100 text-amber-900' : 'bg-slate-100 text-slate-700'
                      }`}
                      onClick={() => onTogglePin(area.microAreaId)}
                    >
                      {isPinned ? 'Pinned' : 'Pin'}
                    </button>
                    <button
                      type="button"
                      className={`rounded-md px-2 py-1 text-xs ${
                        isCompared ? 'bg-cyan-100 text-cyan-900' : 'bg-slate-100 text-slate-700'
                      }`}
                      onClick={() => onToggleCompare(area.microAreaId)}
                    >
                      {isCompared ? 'Compared' : 'Compare'}
                    </button>
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
