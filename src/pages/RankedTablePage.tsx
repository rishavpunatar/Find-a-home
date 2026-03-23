import { ErrorState } from '@/components/ErrorState'
import { LoadingState } from '@/components/LoadingState'
import { RankedTable } from '@/components/table/RankedTable'
import { useDataContext } from '@/context/DataContext'
import { useSettings } from '@/context/SettingsContext'
import { useRankedData } from '@/hooks/useRankedData'
import { shortlistToCsv } from '@/lib/csv'
import { formatNumber } from '@/lib/format'

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
  const { loading, error } = useDataContext()
  const { filtered, pinned, ranked } = useRankedData()
  const { pinnedIds, compareIds, togglePin, toggleCompare, filters } = useSettings()

  if (loading) {
    return <LoadingState title="Building ranked table" />
  }

  if (error) {
    return <ErrorState title="Ranked table unavailable" detail={error} />
  }

  const pinner = ranked.find((area) => area.stationCode === 'PIN')
  const pinnerInFiltered = filtered.some((area) => area.stationCode === 'PIN')
  const pinnerFailures: string[] = []

  if (pinner && !pinnerInFiltered) {
    if (
      (pinner.commuteTypicalMinutes.value ?? Number.POSITIVE_INFINITY) > filters.maxCommuteMinutes
    ) {
      pinnerFailures.push(
        `Commute ${formatNumber(pinner.commuteTypicalMinutes.value)} min > max ${filters.maxCommuteMinutes} min`,
      )
    }
    if (
      (pinner.driveTimeToPinnerMinutes.value ?? Number.POSITIVE_INFINITY) > filters.maxDriveMinutes
    ) {
      pinnerFailures.push(
        `Drive ${formatNumber(pinner.driveTimeToPinnerMinutes.value)} min > max ${filters.maxDriveMinutes} min`,
      )
    }
    if (pinner.componentScores.schools < filters.minSchoolScore) {
      pinnerFailures.push(
        `School score ${pinner.componentScores.schools.toFixed(1)} < min ${filters.minSchoolScore}`,
      )
    }
    if (
      (pinner.crimeRatePerThousand.value ?? Number.POSITIVE_INFINITY) >
      filters.maxCrimeRatePerThousand
    ) {
      pinnerFailures.push(
        `Crime ${formatNumber(pinner.crimeRatePerThousand.value, 1)} > max ${filters.maxCrimeRatePerThousand}`,
      )
    }
    if ((pinner.annualNo2.value ?? Number.POSITIVE_INFINITY) > filters.maxNo2) {
      pinnerFailures.push(`NO2 ${formatNumber(pinner.annualNo2.value, 1)} > max ${filters.maxNo2}`)
    }
    if ((pinner.greenCoverPct.value ?? 0) < filters.minGreenCoverPct) {
      pinnerFailures.push(
        `Green ${formatNumber(pinner.greenCoverPct.value, 1)}% < min ${filters.minGreenCoverPct}%`,
      )
    }
    if (
      (pinner.medianSemiDetachedPrice.value ?? Number.POSITIVE_INFINITY) > filters.maxMedianPrice
    ) {
      pinnerFailures.push(
        `Median price ${formatNumber(pinner.medianSemiDetachedPrice.value)} > max ${formatNumber(filters.maxMedianPrice)}`,
      )
    }
  }

  return (
    <div className="space-y-4">
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

      <section className="grid gap-4 lg:grid-cols-2">
        <article className="rounded-2xl border border-teal-100 bg-white p-4 shadow-panel">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
            How key columns are determined
          </h2>
          <dl className="mt-3 space-y-2 text-sm">
            <div>
              <dt className="font-medium text-slate-800">School</dt>
              <dd className="text-slate-600">
                Composite sub-score from nearby primary/secondary quality and school counts. Higher
                is better.
              </dd>
            </div>
            <div>
              <dt className="font-medium text-slate-800">NO2</dt>
              <dd className="text-slate-600">
                Annual mean NO2 (ug/m3) for the station micro-area proxy. Lower is better.
              </dd>
            </div>
            <div>
              <dt className="font-medium text-slate-800">Crime</dt>
              <dd className="text-slate-600">
                Annualised crime rate per 1,000 residents proxy. Lower is better.
              </dd>
            </div>
            <div>
              <dt className="font-medium text-slate-800">Green</dt>
              <dd className="text-slate-600">
                Green-cover percentage in and around the micro-area. Higher is better.
              </dd>
            </div>
            <div>
              <dt className="font-medium text-slate-800">Confidence</dt>
              <dd className="text-slate-600">
                Combined confidence score from metric-level confidence plus overlap confidence.
              </dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-slate-500">
            Current MVP dataset is fixture-backed proxy data. Use the source links below to
            integrate and validate with live official feeds.
          </p>
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            <a
              href="https://www.gov.uk/government/statistical-data-sets/price-paid-data-downloads"
              target="_blank"
              rel="noreferrer"
              className="rounded-md bg-slate-100 px-2 py-1 text-slate-700 hover:bg-slate-200"
            >
              HM Land Registry (price paid)
            </a>
            <a
              href="https://data.police.uk/docs/"
              target="_blank"
              rel="noreferrer"
              className="rounded-md bg-slate-100 px-2 py-1 text-slate-700 hover:bg-slate-200"
            >
              data.police.uk (crime)
            </a>
            <a
              href="https://uk-air.defra.gov.uk/data/pcm-data"
              target="_blank"
              rel="noreferrer"
              className="rounded-md bg-slate-100 px-2 py-1 text-slate-700 hover:bg-slate-200"
            >
              DEFRA UK-AIR (NO2/PM2.5)
            </a>
            <a
              href="https://www.gov.uk/guidance/get-information-about-schools"
              target="_blank"
              rel="noreferrer"
              className="rounded-md bg-slate-100 px-2 py-1 text-slate-700 hover:bg-slate-200"
            >
              DfE GIAS (schools)
            </a>
            <a
              href="https://www.ordnancesurvey.co.uk/opengreenspace"
              target="_blank"
              rel="noreferrer"
              className="rounded-md bg-slate-100 px-2 py-1 text-slate-700 hover:bg-slate-200"
            >
              OS Open Greenspace
            </a>
          </div>
        </article>

        <article className="rounded-2xl border border-teal-100 bg-white p-4 shadow-panel">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
            Why Pinner may not appear
          </h2>
          {!pinner ? (
            <p className="mt-2 text-sm text-slate-600">
              Pinner is not in the current dataset scope.
            </p>
          ) : pinnerInFiltered ? (
            <p className="mt-2 text-sm text-emerald-700">
              Pinner is included in the currently filtered results.
            </p>
          ) : (
            <div className="mt-2">
              <p className="text-sm text-slate-600">
                Pinner exists in the dataset but is excluded by active filters:
              </p>
              <ul className="mt-2 list-disc pl-5 text-sm text-slate-700">
                {pinnerFailures.map((failure) => (
                  <li key={failure}>{failure}</li>
                ))}
              </ul>
            </div>
          )}
        </article>
      </section>

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
