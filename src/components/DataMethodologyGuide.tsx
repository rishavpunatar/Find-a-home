import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { useDataContext } from '@/context/DataContext'
import { useSettings } from '@/context/SettingsContext'
import { rankingAxes } from '@/lib/rankingAxes'

const InfoCard = ({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) => (
  <details className="rounded-2xl border border-teal-100 bg-white p-4 shadow-panel" open>
    <summary className="cursor-pointer text-base font-semibold text-slate-900">{title}</summary>
    <div className="mt-2 space-y-2 text-sm text-slate-700">{children}</div>
  </details>
)

const DetailBlock = ({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) => (
  <details className="rounded-lg border border-slate-200 bg-slate-50 p-3" open>
    <summary className="cursor-pointer font-medium text-slate-900">{title}</summary>
    <div className="mt-2 space-y-1 text-sm text-slate-600">{children}</div>
  </details>
)

interface DataMethodologyGuideProps {
  variant?: 'compact' | 'full'
}

export const DataMethodologyGuide = ({
  variant = 'compact',
}: DataMethodologyGuideProps) => {
  const { dataset } = useDataContext()
  const { normalizedWeights, weightingMode } = useSettings()
  const sourceMetadata = dataset?.config.sourceMetadata ?? {}
  const propertyReferencePeriod =
    sourceMetadata.property?.referencePeriod ??
    'Current asking-price snapshot for semi-detached 3+ bed / 2+ bath listings, with latest sold-price fallback where live coverage is thin'
  const schoolsReferencePeriod =
    sourceMetadata.schools?.referencePeriod ??
    'official DfE state-funded school composite with current GIAS footprint and latest available EES performance windows'
  const pollutionReferencePeriod =
    sourceMetadata.pollution?.referencePeriod ??
    'DEFRA PCM 2024 annual mean NO2 and PM2.5 1km grids'
  const crimeReferencePeriod =
    sourceMetadata.crime?.referencePeriod ??
    'latest available police months annualised from direct data.police.uk station-area pulls'
  const greenReferencePeriod =
    sourceMetadata.greenSpace?.referencePeriod ??
    'current OS Open Greenspace GB GeoPackage snapshot'
  const transportReferencePeriod =
    sourceMetadata.transport?.referencePeriod ??
    'TfL Journey Planner central-London core snapshots plus TfL StopPoint arrivals and OSRM routing where available'
  const qolSource = dataset?.config.boroughQolSource
  const qolCoveragePeriod = qolSource?.coveragePeriod ?? 'up to 2022-23'
  const qolReleaseDate = qolSource?.releaseDate ?? '2023-11-28'
  const centralDestination = dataset?.destinationStation ?? 'central London core'
  const overallFormula = `(${rankingAxes
    .map((axis) => `${axis.label} x ${normalizedWeights[axis.key].toFixed(1)}`)
    .join(' + ')}) / 100 x confidence factor`

  return (
    <div className="space-y-4">
      {variant === 'full' ? (
        <>
          <section className="grid gap-4 lg:grid-cols-3">
            <InfoCard title="What this tool is actually doing">
              <p>
                This app is not trying to tell you the single “best” place in London. It is trying
                to help you narrow a very large search down into a manageable shortlist of station
                areas that fit the kind of home and trade-offs you care about.
              </p>
              <p>
                The ranking works by combining four weighted axes into one shortlist model:
                transport, schools, environment, and crime.
              </p>
              <p>
                Median semi-detached price is still shown and can be used as a shortlist filter,
                but it no longer changes the weighted rank.
              </p>
            </InfoCard>

            <InfoCard title="What a micro-area means here">
              <p>
                A micro-area is not an official neighbourhood boundary. In this app it means a
                station-centred catchment, roughly an 800m walk area around a station.
              </p>
              <p>
                So when you compare two rows, you are really comparing two station catchments, not
                two formal postcode districts or council-defined neighbourhoods.
              </p>
            </InfoCard>

            <InfoCard title="How to read the ranking">
              <p>
                Each score axis is converted onto a 0-100 scale so unlike-for-like things can be
                compared in one model.
              </p>
              <p>
                The overall score is then a weighted blend of those axis scores, followed by a
                confidence adjustment. So the same raw school count or commute number does not
                flow straight into the final rank on its own.
              </p>
              <p>
                Your weight settings are still the main control. If you switch on the optional
                spread-aware default mode, the app only makes a mild adjustment to the default mix
                using dataset-wide spread and confidence.
              </p>
            </InfoCard>
          </section>

          <section className="rounded-2xl border border-teal-100 bg-white p-4 shadow-panel">
            <h2 className="text-lg font-semibold text-slate-900">What a score actually means</h2>
            <div className="mt-3 space-y-3 text-sm text-slate-700">
              <p>
                A score here is not a percentage chance that you will like an area. It is a
                ranking number built inside this app&apos;s search universe. A station with a score
                of 72 is doing better on the weighted mix of ranked axes than a station with a score
                of 58, under the current weight settings and confidence adjustment.
              </p>
              <p>
                The component scores are each first put onto a 0-100 basis. The app then applies
                the current weights, adds those weighted pieces together, and finally scales the
                result by a confidence factor between 0.5 and 1.0. That means weaker evidence can
                pull the final overall score down, but it does not automatically zero it out.
              </p>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Current overall-score formula
                </p>
                <p className="mt-2 font-mono text-xs text-slate-700">{overallFormula}</p>
                <p className="mt-2 text-xs text-slate-600">
                  Current weighting mode:{' '}
                  <span className="font-medium">
                    {weightingMode === 'manual' ? 'Manual weights' : 'Spread-aware defaults'}
                  </span>
                  . Confidence factor = 0.5 + (data confidence x 0.5).
                </p>
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-teal-100 bg-white p-4 shadow-panel">
            <h2 className="text-lg font-semibold text-slate-900">What each score axis means</h2>
            <p className="mt-2 text-sm text-slate-700">
              These are the main score axes you see across the app and in the overall ranking
              logic. Each card shows what the axis means, how it is built, and how much weight it
              currently carries in the overall rank.
            </p>
            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {rankingAxes.map((axis) => (
                <article
                  key={axis.label}
                  className="rounded-xl border border-slate-200 bg-slate-50 p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="font-semibold text-slate-900">{axis.label}</h3>
                    <span className="rounded-full bg-white px-2 py-0.5 text-xs font-medium text-slate-600">
                      Weight {normalizedWeights[axis.key].toFixed(1)}%
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-slate-600">{axis.detail}</p>
                  <p className="mt-2 text-sm text-slate-600">
                    <span className="font-medium text-slate-700">How it is built:</span>{' '}
                    {axis.recipe}
                  </p>
                  <p className="mt-2 text-xs text-slate-500">
                    <span className="font-semibold">Formula:</span> {axis.formula}
                  </p>
                  <p className="mt-2 text-xs text-slate-500">
                    In the overall ranking, this axis currently contributes{' '}
                    <span className="font-semibold">
                      {normalizedWeights[axis.key].toFixed(1)}%
                    </span>{' '}
                    of the pre-confidence weighted score.
                  </p>
                </article>
              ))}
            </div>
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <InfoCard title="How the data is gathered in plain English">
              <p>
                The app pulls together public-source data and a few carefully labelled fallback
                methods. It does not scrape everything live every time you open the page.
              </p>
              <p>
                Instead, the pipeline gathers and refreshes source data, builds one processed
                dataset, and the frontend reads that prepared dataset quickly in your browser.
              </p>
              <p>
                Where the app has direct source-backed numbers, it says so. Where it has to model,
                blend, or estimate, it says that too.
              </p>
            </InfoCard>

            <InfoCard title="How to judge trust and limitations">
              <p>
                A higher confidence percentage means the underlying evidence is stronger or more
                complete. It does not mean the area is better to live in.
              </p>
              <p>
                Source-backed is usually stronger than modelled, but even source-backed data can
                still be imperfect if the underlying public source is sparse or slow to update.
              </p>
              <p>
                Use this tool to shortlist. Then verify your finalists with actual listings,
                school websites, maps, and in-person checks.
              </p>
            </InfoCard>
          </section>
        </>
      ) : null}

      <section>
        <article className="rounded-2xl border border-teal-100 bg-white p-4 shadow-panel">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
            {variant === 'full'
              ? 'How each ranking axis is built and sourced'
              : 'How ranked axes are determined'}
          </h2>
          <div className="mt-3 space-y-3 text-sm text-slate-700">
            <DetailBlock title="Price axis">
              <p>
                The price axis starts from the target home type:
                semi-detached homes with at least 3 bedrooms and 2 bathrooms.
              </p>
              <p>
                The underlying property evidence starts with current OnTheMarket listings around the
                station catchment. Nearer listings count more than farther ones.
              </p>
              <p>
                If the direct station locality page is too thin, the pipeline can widen to a nearby
                locality page, but only if the listings still land inside a bounded station-area
                radius.
              </p>
              <p>
                If live listing coverage is still too thin, the pipeline falls back to recent HM
                Land Registry sold-price data, first using the tighter local catchment and then an
                explicitly lower-confidence extended nearby area.
              </p>
              <p>
                The ranking score for this axis is a simple inverse transform of the local median
                semi-detached price. Lower prices score higher. Higher prices score lower.
              </p>
              <p>
                <span className="font-semibold">Source:</span> OnTheMarket current locality search
                results + nearby locality fallbacks within a bounded station-area radius + HM Land
                Registry Price Paid Data fallback.
              </p>
              <p>
                <span className="font-semibold">Data reference period:</span>{' '}
                {propertyReferencePeriod}.
              </p>
              <p className="text-xs text-slate-500">
                The ranked table shows the median price as the clearest raw property read, but the
                axis itself is a transformed 0-100 score, not the raw GBP number.
              </p>
            </DetailBlock>

            <DetailBlock title="Transport axis">
              <p>
                The transport axis is about how practical the station is for getting into{' '}
                {centralDestination}.
              </p>
              <p>
                The pipeline uses TfL Journey Planner snapshots for commute time, interchange
                count, and part of the peak service picture. Where needed, it can also use live
                TfL station arrivals to strengthen the service-frequency estimate.
              </p>
              <p>
                Drive time back to Pinner is still kept as a separate optional access signal. It is
                useful if Pinner matters to you, but it is no longer treated as the core transport
                test for the whole app.
              </p>
              <p>
                <span className="font-semibold">Source:</span> TfL Journey Planner central-London
                core queries + TfL StopPoint arrivals + OSRM routing.
              </p>
              <p>
                <span className="font-semibold">Data reference period:</span>{' '}
                {transportReferencePeriod}.
              </p>
            </DetailBlock>

            <DetailBlock title="Schools axis">
              <p>
                The school score is now explicitly primary-only. It combines how many
                state-funded primary schools look realistically reachable and how strong those
                schools look in official data.
              </p>
              <p>
                The access side is population-adjusted, so areas are not rewarded just for sitting
                inside a denser part of London with a larger surrounding population base.
              </p>
              <p>
                In scoring terms, the access side no longer treats every school within a 20-minute
                drive as equally available. It downweights farther schools and discounts schools
                whose published characteristics make general admission less likely, especially faith
                designations. National open data does not directly expose sibling or feeder
                priority, so this remains a cautious heuristic rather than an offer-probability
                model.
              </p>
              <p>
                School access is normalized by a local population denominator so dense areas are
                not rewarded just for having more schools nearby. That denominator is now built
                directly from official ONS LSOA populations intersected with the station catchment,
                rather than from a checked-in proxy figure.
              </p>
              <p>
                The quality side is a smoothed KS2 basket using combined expected standard,
                combined higher standard, average reading scaled score, and average maths scaled
                score, averaged across the latest eligible 2023-onward years where available.
              </p>
              <p>
                Attendance is used as one light-touch extra non-attainment signal. Ofsted is kept
                separate as an overlay or modest penalty flag rather than the main ranking driver.
              </p>
              <p>
                Private schools are excluded from both the access side and the attainment side.
              </p>
              <p>
                <span className="font-semibold">Source:</span> DfE GIAS open state-funded school
                records + DfE Explore Education Statistics school performance data.
              </p>
              <p>
                <span className="font-semibold">Data reference period:</span>{' '}
                {schoolsReferencePeriod}.
              </p>
            </DetailBlock>

            <DetailBlock title="Environment axis">
              <p>
                The environment axis mixes air quality with greenery. It combines PM2.5, NO2,
                green cover, green-space area within 1 km, and nearest-park distance into one
                0-100 environment score.
              </p>
              <p>
                PM2.5 is the app&apos;s main air-quality input. Lower numbers are better because
                they mean fewer fine particles in the air. The app now uses one consistent
                official pollution source across the whole search universe: DEFRA&apos;s PCM
                modelled background grids.
              </p>
              <p>
                On the green side, the app now uses Ordnance Survey&apos;s OS Open Greenspace to
                estimate green cover, nearby green-space area, and park access. Green cover is
                measured over a wider double-radius station buffer so the score reflects the
                broader neighborhood canopy rather than only the immediate 800m catchment, and
                nearest-park distance prefers mapped access points where available.
              </p>
              <p>
                <span className="font-semibold">Source:</span> DEFRA UK-AIR PCM modelled
                background pollution data + Ordnance Survey OS Open Greenspace.
              </p>
              <p>
                <span className="font-semibold">Data reference period:</span>{' '}
                {pollutionReferencePeriod}; greenspace refresh {greenReferencePeriod}.
              </p>
            </DetailBlock>

            <DetailBlock title="Crime axis">
              <p>
                This is an annualized crime rate for a wider station-area catchment, currently
                measured within 1800 meters of the station. Lower raw numbers are better.
              </p>
              <p>
                The app converts that into a higher-is-better safety score inside the ranking
                model, but the raw table value is still shown in the more intuitive per-1,000
                format.
              </p>
              <p>
                The raw rate is now averaged across all currently available monthly police snapshots
                from 2023 onward, rather than just a short recent window.
              </p>
              <p>
                <span className="font-semibold">Source:</span> official data.police.uk monthly
                street-level archive downloads, annualised with the local population denominator.
                That denominator is now taken from an official geometry-based ONS population
                estimate for the same wider crime catchment.
              </p>
              <p>
                <span className="font-semibold">Data reference period:</span> {crimeReferencePeriod}
                .
              </p>
            </DetailBlock>
          </div>
          <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
            <p className="font-semibold">Context-only measures</p>
            <p className="mt-1">
              Borough QoL is shown in some table, detail, and trends views as borough-wide context,
              not as a weighted ranking axis. It comes from ONS personal well-being estimates by
              local authority, with coverage {qolCoveragePeriod} and ONS release date {qolReleaseDate}.
            </p>
            <p className="mt-1">
              Confidence is also not a ranking axis. It is an evidence-strength flag that blends
              metric-level confidence with catchment overlap. Dataset-wide verification and quality
              checks are surfaced on the{' '}
              <Link to="/" className="font-medium text-surge hover:underline">
                Overview
              </Link>{' '}
              page.
            </p>
          </div>

          <p className="mt-3 text-xs text-slate-500">
            All displayed values carry status, confidence, methodology note, and last-updated
            metadata in the micro-area detail view and dataset JSON.
          </p>

          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            <a
              href="https://www.onthemarket.com/"
              target="_blank"
              rel="noreferrer"
              className="rounded-md bg-slate-100 px-2 py-1 text-slate-700 hover:bg-slate-200"
            >
              OnTheMarket
            </a>
            <a
              href="https://www.gov.uk/government/statistical-data-sets/price-paid-data-downloads"
              target="_blank"
              rel="noreferrer"
              className="rounded-md bg-slate-100 px-2 py-1 text-slate-700 hover:bg-slate-200"
            >
              HM Land Registry
            </a>
            <a
              href="https://api.tfl.gov.uk/"
              target="_blank"
              rel="noreferrer"
              className="rounded-md bg-slate-100 px-2 py-1 text-slate-700 hover:bg-slate-200"
            >
              TfL API
            </a>
            <a
              href="https://project-osrm.org/"
              target="_blank"
              rel="noreferrer"
              className="rounded-md bg-slate-100 px-2 py-1 text-slate-700 hover:bg-slate-200"
            >
              OSRM
            </a>
            <a
              href="https://data.police.uk/docs/"
              target="_blank"
              rel="noreferrer"
              className="rounded-md bg-slate-100 px-2 py-1 text-slate-700 hover:bg-slate-200"
            >
              data.police.uk
            </a>
            <a
              href="https://uk-air.defra.gov.uk/data/pcm-data"
              target="_blank"
              rel="noreferrer"
              className="rounded-md bg-slate-100 px-2 py-1 text-slate-700 hover:bg-slate-200"
            >
              DEFRA UK-AIR
            </a>
            <a
              href="https://www.gov.uk/guidance/get-information-about-schools"
              target="_blank"
              rel="noreferrer"
              className="rounded-md bg-slate-100 px-2 py-1 text-slate-700 hover:bg-slate-200"
            >
              DfE GIAS
            </a>
            <a
              href="https://explore-education-statistics.service.gov.uk/find-statistics"
              target="_blank"
              rel="noreferrer"
              className="rounded-md bg-slate-100 px-2 py-1 text-slate-700 hover:bg-slate-200"
            >
              DfE EES
            </a>
            <a
              href="https://www.ordnancesurvey.co.uk/products/os-open-greenspace"
              target="_blank"
              rel="noreferrer"
              className="rounded-md bg-slate-100 px-2 py-1 text-slate-700 hover:bg-slate-200"
            >
              OS Open Greenspace
            </a>
            <a
              href="https://www.ons.gov.uk/peoplepopulationandcommunity/populationandmigration/populationestimates/datasets/lowersuperoutputareamidyearpopulationestimatesnationalstatistics"
              target="_blank"
              rel="noreferrer"
              className="rounded-md bg-slate-100 px-2 py-1 text-slate-700 hover:bg-slate-200"
            >
              ONS LSOA population
            </a>
            <a
              href="https://www.ons.gov.uk/datasets/wellbeing-local-authority"
              target="_blank"
              rel="noreferrer"
              className="rounded-md bg-slate-100 px-2 py-1 text-slate-700 hover:bg-slate-200"
            >
              ONS well-being
            </a>
          </div>
        </article>
      </section>

      {variant === 'full' ? (
        <section className="rounded-2xl border border-teal-100 bg-white p-4 shadow-panel">
          <h2 className="text-lg font-semibold text-slate-900">What the labels mean in practice</h2>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <article className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <h3 className="font-semibold text-slate-900">Status labels</h3>
              <ul className="mt-2 space-y-1 text-sm text-slate-600">
                <li>
                  <span className="font-medium text-slate-900">Available:</span> the app has a
                  usable number for this metric.
                </li>
                <li>
                  <span className="font-medium text-slate-900">Estimated:</span> the app had to
                  infer or interpolate because direct coverage was incomplete.
                </li>
                <li>
                  <span className="font-medium text-slate-900">Placeholder or missing:</span> the
                  metric is weak or unavailable and should not drive a final decision.
                </li>
              </ul>
            </article>

            <article className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <h3 className="font-semibold text-slate-900">Evidence labels</h3>
              <ul className="mt-2 space-y-1 text-sm text-slate-600">
                <li>
                  <span className="font-medium text-slate-900">Current listings:</span> live-ish
                  market asking evidence.
                </li>
                <li>
                  <span className="font-medium text-slate-900">
                    Current listings (extended area):
                  </span>{' '}
                  still current market evidence, but drawn from a slightly wider nearby radius.
                </li>
                <li>
                  <span className="font-medium text-slate-900">Recent sold-price fallback:</span>{' '}
                  real recent transactions, but not a live asking-price view.
                </li>
                <li>
                  <span className="font-medium text-slate-900">Modelled or heuristic:</span> a
                  weaker proxy used when direct evidence is incomplete.
                </li>
              </ul>
            </article>
          </div>
        </section>
      ) : null}
    </div>
  )
}
