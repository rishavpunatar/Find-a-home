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
    'Current asking-price snapshot for semi-detached 3+ bed / 2+ bath listings, with latest sold-price fallback where live coverage is thin'
  const schoolsReferencePeriod =
    sourceMetadata.schools?.referencePeriod ??
    'official DfE state-funded school composite with current GIAS footprint and latest available EES performance windows'
  const pollutionReferencePeriod =
    sourceMetadata.pollution?.referencePeriod ??
    'LAEI 2019 (London modelled layers) and DEFRA LAQM 2023 extraction for non-London'
  const crimeReferencePeriod =
    sourceMetadata.crime?.referencePeriod ??
    'latest available police months annualised from direct data.police.uk station-area pulls'
  const greenReferencePeriod =
    sourceMetadata.greenSpace?.referencePeriod ??
    'current OpenStreetMap greenspace geometry pull via Overpass API'

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
                Station with direct property record: use station median asking price from current
                locality listings for semi-detached homes with at least 3 bedrooms and 2
                bathrooms.
              </p>
              <p className="mt-1 text-slate-600">
                Listings are distance-weighted back to the station area so nearer qualifying homes
                have more influence on the median and average.
              </p>
              <p className="mt-1 text-slate-600">
                If current listing coverage is too thin, the pipeline falls back to recent HM Land
                Registry semi-detached transactions; if a station still has no direct property
                record, it is estimated from nearby property anchors.
              </p>
              <p className="mt-1 text-slate-600">
                <span className="font-semibold">Source:</span> OnTheMarket current locality search
                results + HM Land Registry Price Paid Data fallback.
              </p>
              <p className="mt-1 text-slate-600">
                <span className="font-semibold">Data reference period:</span>{' '}
                {propertyReferencePeriod}.
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Median is shown instead of average in the table because it is less sensitive to a
                few unusually expensive listings.
              </p>
              <p className="mt-1 text-xs text-slate-500">
                The table also labels each row&apos;s price evidence as either current listings or
                recent sold-price fallback.
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
                <span className="font-semibold">Source:</span> DfE GIAS open state-funded school
                records + DfE Explore Education Statistics school performance data.
              </p>
              <p className="mt-1 text-slate-600">
                <span className="font-semibold">Data reference period:</span>{' '}
                {schoolsReferencePeriod}.
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Both nearby-school counts and school-quality scores now use state-funded-only DfE
                data, so private schools are excluded from both sides of the school component. The
                school catchment is based on an approximately 20-minute road-adjusted drive-time
                proxy from the area anchor.
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
                Annualized crime rate per 1,000 residents (`crimeRatePerThousand` metric).
              </p>
              <p className="mt-1 text-slate-600">
                <span className="font-semibold">Source:</span> direct `data.police.uk` custom-area
                incident pulls for the latest available months, annualised with the local
                population denominator.
              </p>
              <p className="mt-1 text-slate-600">
                <span className="font-semibold">Data reference period:</span> {crimeReferencePeriod}
                , with a fresh police-feed cross-check available in verification reports.
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
                Percentage green cover (`greenCoverPct`) around the station catchment.
              </p>
              <p className="mt-1 text-slate-600">
                Method: distance-weighted blend of station green-cover values within a wider radius
                of 1,600m (2x the 800m walk catchment) so nearby green context beyond the immediate
                station circle is reflected.
              </p>
              <p className="mt-1 text-slate-600">
                <span className="font-semibold">Source:</span> OpenStreetMap greenspace polygons
                via Overpass API, with a wider neighbourhood blend for this specific percentage
                metric.
              </p>
              <p className="mt-1 text-slate-600">
                <span className="font-semibold">Data reference period:</span> {greenReferencePeriod}
                .
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
              href="https://www.onthemarket.com/"
              target="_blank"
              rel="noreferrer"
              className="rounded-md bg-slate-100 px-2 py-1 text-slate-700 hover:bg-slate-200"
            >
              OnTheMarket (current listings)
            </a>
            <a
              href="https://www.gov.uk/government/statistical-data-sets/price-paid-data-downloads"
              target="_blank"
              rel="noreferrer"
              className="rounded-md bg-slate-100 px-2 py-1 text-slate-700 hover:bg-slate-200"
            >
              HM Land Registry (fallback sold prices)
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
              href="https://explore-education-statistics.service.gov.uk/find-statistics"
              target="_blank"
              rel="noreferrer"
              className="rounded-md bg-slate-100 px-2 py-1 text-slate-700 hover:bg-slate-200"
            >
              DfE EES (school performance)
            </a>
            <a
              href="https://overpass-api.de/"
              target="_blank"
              rel="noreferrer"
              className="rounded-md bg-slate-100 px-2 py-1 text-slate-700 hover:bg-slate-200"
            >
              Overpass / OpenStreetMap
            </a>
            <a
              href="https://www.planning.data.gov.uk/"
              target="_blank"
              rel="noreferrer"
              className="rounded-md bg-slate-100 px-2 py-1 text-slate-700 hover:bg-slate-200"
            >
              planning.data.gov.uk
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
