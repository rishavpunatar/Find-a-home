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

export const RankedTablePage = () => {
  const { loading, error, dataset } = useDataContext()
  const { filtered, pinned } = useRankedData()
  const { pinnedIds, compareIds, togglePin, toggleCompare } = useSettings()

  if (loading) {
    return <LoadingState title="Building ranked table" />
  }

  if (error || !dataset) {
    return (
      <ErrorState
        title="Ranked table unavailable"
        detail={error ?? 'Dataset is missing. Run the pipeline and sync processed files.'}
      />
    )
  }

  const qolSource = dataset.config.boroughQolSource
  const qolCoveragePeriod = qolSource?.coveragePeriod ?? 'up to 2022-23'
  const qolReleaseDate = qolSource?.releaseDate ?? '2023-11-28'
  const sourceMetadata = dataset.config.sourceMetadata ?? {}
  const propertyReferencePeriod =
    sourceMetadata.property?.referencePeriod ??
    'mixed fixture composite; a single source-traceable national cut date is not yet wired for all stations'
  const schoolsReferencePeriod =
    sourceMetadata.schools?.referencePeriod ??
    'mixed-year composite proxy (no single source-traceable national cut date wired yet)'
  const pollutionReferencePeriod =
    sourceMetadata.pollution?.referencePeriod ??
    'LAEI 2019 (London modelled layers) and DEFRA LAQM 2023 extraction for non-London'
  const crimeReferencePeriod =
    sourceMetadata.crime?.referencePeriod ??
    'proxy composite (no single source-traceable annual cut date yet)'
  const greenReferencePeriod =
    sourceMetadata.greenSpace?.referencePeriod ??
    'mixed proxy baseline (single authoritative timestamp not yet wired)'

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

      <section>
        <article className="rounded-2xl border border-teal-100 bg-white p-4 shadow-panel">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
            How key columns are determined
          </h2>
          <div className="mt-3 space-y-3 text-sm text-slate-700">
            <details className="rounded-lg border border-slate-200 bg-slate-50 p-3" open>
              <summary className="cursor-pointer font-medium text-slate-900">
                Median semi-detached house price (GBP)
              </summary>
              <p className="mt-2 text-slate-600">
                Displayed value is `medianSemiDetachedPrice`, used directly in table filters and in
                value/affordability scoring.
              </p>
              <p className="mt-1 text-slate-600">
                Station with direct property record: use station median semi-detached sold price
                from the property adapter (`status = available`).
              </p>
              <p className="mt-1 text-slate-600">
                Station without direct property record: estimate using inverse-distance weighting
                over nearby property anchors (`weight = 1 / max(distance_m, 120)^1.8`, up to 8
                nearest stations), then `median = sum(value * weight) / sum(weight)` (`status =
                estimated`).
              </p>
              <p className="mt-1 text-slate-600">
                <span className="font-semibold">Source:</span> HM Land Registry Price Paid Data via
                fixture-backed station property metrics in this MVP pipeline.
              </p>
              <p className="mt-1 text-slate-600">
                <span className="font-semibold">Data reference period:</span> mixed fixture
                composite; {propertyReferencePeriod}.
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Median is shown instead of average in the table because it is less sensitive to a
                few unusually expensive transactions.
              </p>
            </details>

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
              <p className="mt-1 text-slate-600">
                <span className="font-semibold">Source:</span> DfE GIAS + fixture-backed local
                school composites.
              </p>
              <p className="mt-1 text-slate-600">
                <span className="font-semibold">Data reference period:</span> mixed-year composite
                proxy ({schoolsReferencePeriod}).
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Inputs come from nearby-school composites; status can be available or estimated.
              </p>
            </details>

            <details className="rounded-lg border border-slate-200 bg-slate-50 p-3" open>
              <summary className="cursor-pointer font-medium text-slate-900">
                QoL (0-100, borough-level ONS APS, higher is better)
              </summary>
              <p className="mt-2 text-slate-600">
                Borough QoL score linked to the micro-area local authority from ONS APS personal
                well-being means.
              </p>
              <p className="mt-1 text-slate-600">
                Composite formula: `((life satisfaction + worthwhile + happiness + (10 -
                anxiety)) / 4) * 10`, using the latest available APS period from ONS local
                authority series.
              </p>
              <p className="mt-1 text-slate-600">
                <span className="font-semibold">Source:</span> ONS personal well-being estimates by
                local authority (APS).
              </p>
              <p className="mt-1 text-slate-600">
                <span className="font-semibold">Data reference period:</span> {qolCoveragePeriod}{' '}
                (ONS release date {qolReleaseDate}).
              </p>
              <p className="mt-1 text-xs text-slate-500">
                This is a borough-wide context signal; it does not represent station-level QoL
                directly.
              </p>
            </details>

            <details className="rounded-lg border border-slate-200 bg-slate-50 p-3" open>
              <summary className="cursor-pointer font-medium text-slate-900">
                PM2.5 (ug/m3, lower is better)
              </summary>
              <p className="mt-2 text-slate-600">
                Annual mean PM2.5 for the micro-area proxy (`annualPm25` metric). This table shows
                raw concentration, not a transformed score.
              </p>
              <p className="mt-1 text-slate-600">
                Method (Greater London): use LAEI 20m modelled PM2.5 cells inside the 800m
                station-centred catchment, then take a distance-weighted mean
                (`w = 1 / max(distance, 20)^1.2`).
              </p>
              <p className="mt-1 text-slate-600">
                Method (outside Greater London): use DEFRA LAQM 1km cells intersecting the 800m
                catchment approximation, then take a distance-weighted mean
                (`w = 1 / max(distance, 200)^1.3`).
              </p>
              <p className="mt-1 text-slate-600">
                <span className="font-semibold">Source:</span> London Datastore LAEI (London) +
                DEFRA UK-AIR LAQM background maps.
              </p>
              <p className="mt-1 text-slate-600">
                <span className="font-semibold">Data reference period:</span> LAEI 2019 (London
                modelled layers) and DEFRA LAQM extraction for non-London ({pollutionReferencePeriod}).
              </p>
              <p className="mt-1 text-xs text-slate-500">
                PM2.5 is the primary air-quality filter in this app. NO2 remains available as a
                secondary metric in the detail view and methodology notes.
              </p>
            </details>

            <details className="rounded-lg border border-slate-200 bg-slate-50 p-3" open>
              <summary className="cursor-pointer font-medium text-slate-900">
                Crime (per 1,000, lower is better)
              </summary>
              <p className="mt-2 text-slate-600">
                Annualized crime-rate proxy per 1,000 residents (`crimeRatePerThousand` metric).
              </p>
              <p className="mt-1 text-slate-600">
                <span className="font-semibold">Source:</span> fixture-backed annualised proxy with
                live cross-check against data.police.uk incidents.
              </p>
              <p className="mt-1 text-slate-600">
                <span className="font-semibold">Data reference period:</span> proxy composite (no
                single source-traceable annual cut date yet: {crimeReferencePeriod}), with live
                monthly cross-check available in verification reports.
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
              <p className="mt-1 text-slate-600">
                Method: distance-weighted blend of station green-cover values within a wider radius
                of 1,600m (2x the 800m walk catchment) so nearby green context beyond the immediate
                station circle is reflected.
              </p>
              <p className="mt-1 text-slate-600">
                <span className="font-semibold">Source:</span> OS Open Greenspace-derived fixture
                proxies plus interpolation.
              </p>
              <p className="mt-1 text-slate-600">
                <span className="font-semibold">Data reference period:</span> mixed proxy baseline
                ({greenReferencePeriod}).
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
              <p className="mt-1 text-slate-600">
                <span className="font-semibold">Source:</span> derived internally from metric-level
                confidence and catchment overlap; not from a single external feed.
              </p>
              <p className="mt-1 text-slate-600">
                <span className="font-semibold">Data reference period:</span> follows each
                underlying metric&apos;s own reference period.
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
            <a
              href="https://www.ons.gov.uk/datasets/wellbeing-local-authority"
              target="_blank"
              rel="noreferrer"
              className="rounded-md bg-slate-100 px-2 py-1 text-slate-700 hover:bg-slate-200"
            >
              ONS APS Well-being
            </a>
          </div>
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
