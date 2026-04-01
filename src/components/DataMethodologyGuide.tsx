import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { useDataContext } from '@/context/DataContext'
import { useSettings } from '@/context/SettingsContext'

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

const scoreAxes = [
  {
    key: 'value',
    label: 'Value',
    detail:
      'A higher value score means the target home type looks cheaper relative to the rest of the search universe once price and commute are both considered.',
    recipe:
      'This starts from the property layer. The app takes the affordability score and the value-for-money score, then averages them into one 0-100 value score.',
    formula: 'Value score = average of affordability score and value-for-money score',
  },
  {
    key: 'transport',
    label: 'Transport',
    detail:
      'A higher transport score means the area has a better commute into the central London core, better peak service, fewer changes, or some combination of those.',
    recipe:
      'This combines four transformed transport inputs: typical commute, peak commute, peak trains-per-hour, and interchange count. Shorter journeys and fewer changes help; stronger service frequency helps.',
    formula:
      'Transport score = typical commute 30% + peak commute 20% + peak service 30% + interchange score 20%',
  },
  {
    key: 'schools',
    label: 'Schools',
    detail:
      'A higher school score means there are more realistically reachable state-funded primary schools and the stronger schools among that primary pool perform better in official data.',
    recipe:
      'This is now a primary-only blend of attainment, access, and a small attendance supplement. Access stays population-adjusted, so dense areas are not rewarded just for having more people around them.',
    formula:
      'School score = primary attainment basket 68% + population-adjusted primary access 22% + attendance 10%, with a modest Ofsted warning penalty when relevant',
  },
  {
    key: 'environment',
    label: 'Environment',
    detail:
      'A higher environment score means cleaner air and better nearby green-space access.',
    recipe:
      'This mixes air quality with greenery. Lower PM2.5, lower NO2, higher green cover, more green area within 1 km, and a shorter distance to the nearest park all help.',
    formula:
      'Environment score = PM2.5 34% + NO2 16% + green cover 20% + green area 18% + park distance 12%',
  },
  {
    key: 'crime',
    label: 'Crime',
    detail:
      'A higher crime score means lower recorded crime in the station-area catchment. It is effectively a safety score.',
    recipe:
      'The raw crime metric is annualised crime incidents per 1,000 residents. Lower raw crime rates are converted into higher-is-better safety scores for ranking.',
    formula: 'Crime score = inverse transform of crime rate per 1,000 residents',
  },
] as const

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
    'LAEI 2019 (London modelled layers) and DEFRA LAQM 2023 extraction for non-London'
  const crimeReferencePeriod =
    sourceMetadata.crime?.referencePeriod ??
    'latest available police months annualised from direct data.police.uk station-area pulls'
  const greenReferencePeriod =
    sourceMetadata.greenSpace?.referencePeriod ??
    'current OpenStreetMap greenspace geometry pull via Overpass API'
  const transportReferencePeriod =
    sourceMetadata.transport?.referencePeriod ??
    'TfL Journey Planner central-London core snapshots plus TfL StopPoint arrivals and OSRM routing where available'
  const qolSource = dataset?.config.boroughQolSource
  const qolCoveragePeriod = qolSource?.coveragePeriod ?? 'up to 2022-23'
  const qolReleaseDate = qolSource?.releaseDate ?? '2023-11-28'
  const centralDestination = dataset?.destinationStation ?? 'central London core'
  const overallFormula = `((Value x ${normalizedWeights.value.toFixed(1)}) + (Transport x ${normalizedWeights.transport.toFixed(1)}) + (Schools x ${normalizedWeights.schools.toFixed(1)}) + (Environment x ${normalizedWeights.environment.toFixed(1)}) + (Crime x ${normalizedWeights.crime.toFixed(1)})) / 100 x confidence factor`

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
                The ranking works by combining housing, commute, schools, air quality, green
                space, and crime into one shortlist model.
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
                of 72 is doing better on the weighted mix of metrics than a station with a score
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
              {scoreAxes.map((axis) => (
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
              ? 'What each key metric means and where it comes from'
              : 'How key columns are determined'}
          </h2>
          <div className="mt-3 space-y-3 text-sm text-slate-700">
            <DetailBlock title="Median semi-detached house price (GBP)">
              <p>
                This is the app&apos;s best estimate of what a semi-detached home with at least 3
                bedrooms and 2 bathrooms costs around that station area.
              </p>
              <p>
                First, the pipeline looks for current OnTheMarket listings that match that home
                type. Nearer listings count more than farther ones.
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
                <span className="font-semibold">Source:</span> OnTheMarket current locality search
                results + nearby locality fallbacks within a bounded station-area radius + HM Land
                Registry Price Paid Data fallback.
              </p>
              <p>
                <span className="font-semibold">Data reference period:</span>{' '}
                {propertyReferencePeriod}.
              </p>
              <p className="text-xs text-slate-500">
                The app uses median rather than average in the table because median is less easily
                distorted by a few unusually expensive homes.
              </p>
            </DetailBlock>

            <DetailBlock title="Transport and commute">
              <p>
                This is about how practical the station is for getting into {centralDestination}.
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

            <DetailBlock title="School (0-100, higher is better)">
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
                Where a direct catchment population denominator is missing, the app uses a fixed
                reference-population fallback so the access score still stays on the same basis.
              </p>
              <p>
                The quality side is a smoothed KS2 basket using combined expected standard,
                combined higher standard, average reading scaled score, and average maths scaled
                score, averaged across the latest 3 years where available.
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

            <DetailBlock title="QoL (borough wellbeing, 0-100, borough-level ONS APS, higher is better)">
              <p>
                This is a borough-wide quality-of-life context score, not a station-level street
                score.
              </p>
              <p>
                It comes from ONS personal well-being estimates and gives a sense of how the wider
                borough performs on life satisfaction, happiness, feeling worthwhile, and anxiety.
              </p>
              <p>
                <span className="font-semibold">Source:</span> ONS personal well-being estimates by
                local authority.
              </p>
              <p>
                <span className="font-semibold">Data reference period:</span> {qolCoveragePeriod}{' '}
                (ONS release date {qolReleaseDate}).
              </p>
            </DetailBlock>

            <DetailBlock title="PM2.5 (ug/m3, lower is better)">
              <p>
                PM2.5 is the app&apos;s main air-quality measure. Lower numbers are better because
                they mean fewer fine particles in the air.
              </p>
              <p>
                Inside Greater London, the app uses detailed London modelled air-quality layers.
                Outside that scope, it uses DEFRA background maps.
              </p>
              <p>
                <span className="font-semibold">Source:</span> London Datastore LAEI (London) +
                DEFRA UK-AIR LAQM background maps.
              </p>
              <p>
                <span className="font-semibold">Data reference period:</span> {pollutionReferencePeriod}
                .
              </p>
            </DetailBlock>

            <DetailBlock title="Crime (per 1,000, lower is better)">
              <p>
                This is an annualized crime rate for the station-area catchment. Lower raw numbers
                are better.
              </p>
              <p>
                The app converts that into a higher-is-better safety score inside the ranking
                model, but the raw table value is still shown in the more intuitive per-1,000
                format.
              </p>
              <p>
                <span className="font-semibold">Source:</span> direct data.police.uk custom-area
                incident pulls, annualised with the local population denominator.
              </p>
              <p>
                <span className="font-semibold">Data reference period:</span> {crimeReferencePeriod}
                .
              </p>
            </DetailBlock>

            <DetailBlock title="Green (% cover, higher is better)">
              <p>
                This is the share of the nearby environment that reads as green cover around the
                station catchment.
              </p>
              <p>
                The app also tracks nearby park distance and total green-space area, but this
                green-cover percentage is the simplest quick read for the ranked table.
              </p>
              <p>
                <span className="font-semibold">Source:</span> OpenStreetMap greenspace polygons
                via Overpass API, with a wider neighbourhood blend for this percentage metric.
              </p>
              <p>
                <span className="font-semibold">Data reference period:</span> {greenReferencePeriod}
                .
              </p>
            </DetailBlock>

            <DetailBlock title="Confidence (%)">
              <p>
                Confidence tells you how robust the evidence is for that area. It does not tell you
                whether the area is desirable.
              </p>
              <p>
                The app blends metric-level confidence with a catchment-overlap adjustment, because
                some station catchments are much more distinct than others.
              </p>
              <p>
                In plain terms: a higher confidence score usually means more of the important
                metrics are source-backed and less of the area depends on thin or indirect
                estimates.
              </p>
              <p className="text-xs text-slate-500">
                Dataset-wide quality checks and verification summaries are shown on the{' '}
                <Link to="/" className="font-medium text-surge hover:underline">
                  Overview
                </Link>{' '}
                page.
              </p>
            </DetailBlock>
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
              href="https://data.london.gov.uk/dataset/london-atmospheric-emissions-inventory--laei--2019"
              target="_blank"
              rel="noreferrer"
              className="rounded-md bg-slate-100 px-2 py-1 text-slate-700 hover:bg-slate-200"
            >
              London Datastore
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
              href="https://overpass-api.de/"
              target="_blank"
              rel="noreferrer"
              className="rounded-md bg-slate-100 px-2 py-1 text-slate-700 hover:bg-slate-200"
            >
              Overpass / OpenStreetMap
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
