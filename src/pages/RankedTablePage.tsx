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
          <div className="mt-3 space-y-3 text-sm text-slate-700">
            <details className="rounded-lg border border-slate-200 bg-slate-50 p-3" open>
              <summary className="cursor-pointer font-medium text-slate-900">
                School (0-100, higher is better)
              </summary>
              <p className="mt-2 text-slate-600">
                Displayed value is the <span className="font-semibold">school component score</span>
                .
              </p>
              <p className="mt-1 text-slate-600">
                Formula: school quality score = mean(primary quality, secondary quality); school
                count score = mean(normalized primary count, normalized secondary count); final
                school score = quality * 0.72 + count * 0.28.
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Inputs come from nearby-school composites; status can be available or estimated.
              </p>
            </details>

            <details className="rounded-lg border border-slate-200 bg-slate-50 p-3" open>
              <summary className="cursor-pointer font-medium text-slate-900">
                NO2 (ug/m3, lower is better)
              </summary>
              <p className="mt-2 text-slate-600">
                Annual mean NO2 for the micro-area proxy (`annualNo2` metric). This table shows raw
                concentration, not a transformed score.
              </p>
              <p className="mt-1 text-slate-600">
                Method (Greater London): use LAEI 20m modelled NO2 cells inside the 800m
                station-centred catchment, then take a distance-weighted mean
                (`w = 1 / max(distance, 20)^1.2`).
              </p>
              <p className="mt-1 text-slate-600">
                Method (outside Greater London): use DEFRA LAQM 1km cells intersecting the 800m
                catchment approximation, then take a distance-weighted mean
                (`w = 1 / max(distance, 200)^1.3`).
              </p>
              <p className="mt-1 text-xs text-slate-500">
                For London rows we store a DEFRA 1km secondary cross-check alongside the LAEI value
                and include the delta in the metric methodology note on the detail page.
              </p>
            </details>

            <details className="rounded-lg border border-slate-200 bg-slate-50 p-3" open>
              <summary className="cursor-pointer font-medium text-slate-900">
                Crime (per 1,000, lower is better)
              </summary>
              <p className="mt-2 text-slate-600">
                Annualized crime-rate proxy per 1,000 residents (`crimeRatePerThousand` metric).
              </p>
              <p className="mt-1 text-xs text-slate-500">
                The ranking model converts this into a score with inverse scaling (lower incident
                rate gives higher crime/safety component score). Live cross-check results are shown
                in the dataset verification section on the Overview page.
              </p>
            </details>

            <details className="rounded-lg border border-slate-200 bg-slate-50 p-3" open>
              <summary className="cursor-pointer font-medium text-slate-900">
                Green (% cover, higher is better)
              </summary>
              <p className="mt-2 text-slate-600">
                Percentage green cover proxy (`greenCoverPct`) around the station catchment.
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Environment scoring also uses green-space area and nearest park distance, but this
                table column is the raw green-cover percentage for direct filtering.
              </p>
            </details>

            <details className="rounded-lg border border-slate-200 bg-slate-50 p-3" open>
              <summary className="cursor-pointer font-medium text-slate-900">
                Confidence (%)
              </summary>
              <p className="mt-2 text-slate-600">
                Confidence shown here is `dataConfidenceScore * 100`.
              </p>
              <p className="mt-1 text-slate-600">
                Formula: `dataConfidenceScore = mean(all metric confidences + overlapConfidence)`.
              </p>
              <p className="mt-1 text-slate-600">
                `overlapConfidence` = `min(1, nearestStationDistanceM / (2 * walkCatchmentRadiusM))`.
                With an 800m catchment, areas very close to another station get lower overlap
                confidence, while more distinct catchments get higher values.
              </p>
              <p className="mt-1 text-slate-600">
                Metric confidence is inherited from each metric source record:
                `available` keeps source confidence, `estimated` uses interpolation confidence, and
                `missing/placeholder` defaults to low confidence (typically 0.2).
              </p>
              <p className="mt-1 text-slate-600">
                Interpolated metrics use distance-aware confidence:
                `clamp(0.28 + 0.42*exp(-nearestKm/18) + 0.2*(anchorConfidenceMean-0.5), 0.2, 0.75)`.
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Confidence reflects data robustness/coverage and overlap ambiguity, not how
                desirable an area is. Dataset-wide quality checks are reported separately in
                `data_quality_report.json` on the Overview page.
              </p>
            </details>
          </div>
          <p className="mt-3 text-xs text-slate-500">
            All metric values also carry status, confidence, methodology note, and last-updated
            metadata in the micro-area detail view and dataset JSON.
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
              href="https://data.london.gov.uk/dataset/london-atmospheric-emissions-inventory--laei--2019"
              target="_blank"
              rel="noreferrer"
              className="rounded-md bg-slate-100 px-2 py-1 text-slate-700 hover:bg-slate-200"
            >
              London Datastore (LAEI)
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
