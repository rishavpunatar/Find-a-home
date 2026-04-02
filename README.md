# Find a Home: Greater London Station Micro-Area Ranking

Static-first web app and pipeline that precomputes and ranks Greater London station-centred micro-areas for buying a semi-detached house with a practical commute into central London.

## Start here if you just want to use the tool

You do not need to install anything if you only want to use the app.

Use this project for:

- narrowing down Greater London station areas for a semi-detached house search
- comparing tradeoffs between commute, price, schools, greenery, crime, and confidence in the data
- building a shortlist before you spend time on Rightmove, Zoopla, or in-person visits

Use the website like this:

1. Open the live site linked from this repo.
2. Leave the filter preset on `Balanced` to start, or switch to `High-confidence only` if you want a stricter shortlist.
3. Go to `Ranked Table` to see the strongest candidates.
4. Use the Pinner drive filter only if access back to Pinner matters to you.
5. Pin the areas you like and compare them side by side.

This project is most useful as a shortlist tool. It is not a guarantee that an area is right for you.

## What this is and is not

This project is:

- a decision-support tool for house hunting
- a way to compare micro-areas around stations, not just whole towns or boroughs
- transparent about where the data is strong and where it is estimated

This project is not:

- mortgage, legal, school-admissions, or investment advice
- a replacement for viewing homes, checking listings, or speaking to agents
- a promise that every metric is sourced from a live verified feed

## What this app does

- Analyses Greater London station-centred micro-areas within a 70-minute commute to central London.
- Models each micro-area as an 800m station walk catchment (configurable).
- Keeps Pinner access as an optional score/filter instead of a hard candidate prefilter.
- Computes value, transport, schools, environment, crime, proximity, and planning-risk component scores.
- Links each micro-area to borough-level QoL from ONS APS personal well-being data.
- Produces an overall weighted ranking with confidence and data-status metadata.
- Lets you adjust weights and filters in the UI, switch between broader and high-confidence views, and inspect results in table, map, and chart views.
- Ships with `Focus`, `Balanced`, and `Explore` filter presets so the first-run experience is useful instead of nearly empty.
- Includes a London-wide tab that prioritizes breadth (commute-only filter, capped at 60 minutes).

## Stack

If you are a developer or want to run the project locally, the rest of this README covers the technical setup.

- Frontend: React + TypeScript + Vite
- Styling: Tailwind CSS
- Charts: Recharts
- Map: Leaflet (`react-leaflet`)
- Pipeline: Python
- Output storage: versioned JSON in `data/processed/`
- CI/CD: GitHub Actions (test, build, scheduled refresh, deploy)

## Screens

- Overview dashboard
- Ranked table (sortable, filterable, pin/compare, CSV export)
- Coverage view tab (same source universe, but with most non-commute filters relaxed)
- Map view (colour by selected metric, detail side panel)
- Comparison view (up to 5 micro-areas)
- Micro-area detail page (raw metrics, statuses, confidence, explanations)
- Weight settings panel (local persistence + normalization)
- Trust mode toggle and per-area trust/domain-availability badges

## Quick start

### 1) Install dependencies

```bash
npm ci
python3 -m pip install -r requirements-dev.txt
```

### 2) Build processed data

```bash
python3 -m pipeline.jobs.build_micro_areas
```

### 2a) (Optional) Regenerate expanded station fixture

```bash
python3 -m pipeline.jobs.generate_station_fixture
```

This refreshes `data/raw/stations_transport.json` from live central-London-centred station geodata and preserves seed records.

### 2b) Generate verification report (live cross-check mode)

```bash
python3 -m pipeline.jobs.verify_data_sources --live
```

### 2c) Run strict dataset quality audit

```bash
npm run pipeline:quality
```

### 2d) Refresh borough QoL metrics from ONS APS

```bash
npm run pipeline:wellbeing
```

### 2e) Refresh transport metrics from live routing sources

```bash
npm run pipeline:transport
```

### 2f) Refresh school metrics from official state-funded DfE school data

```bash
npm run pipeline:schools
```

### 2g) Refresh property metrics from current asking prices

```bash
npm run pipeline:property
```

### 3) Start the app

```bash
npm run dev
```

The dev command runs `sync:data` automatically, so `data/processed/` is copied into `public/data/processed/`.

## Run tests and quality checks

```bash
npm run test
npm run lint
python3 -m pytest
npm run build
```

## Verification report

The pipeline emits:

- `data/processed/verification_report.json`
- `data/processed/data_quality_report.json`
- `verificationSummary` inside `data/processed/micro_areas.json`

Current verification coverage:

- Property: current OnTheMarket listing snapshots with bounded nearby-locality fallbacks, plus HM Land Registry sold-price fallback when live listing coverage is too thin
- Transport: TfL Journey Planner against a central-London core, TfL StopPoint arrivals for service-frequency backfill, and OSRM where available
- Schools: official state-funded DfE sources, using a road-adjusted drive-time accessibility proxy
- Greenspace: direct OpenStreetMap polygon geometry via Overpass
- Crime: direct `data.police.uk` area pulls, with a fresh police-feed cross-check available
- Planning: structured `planning.data.gov.uk` layers feeding a rule-based planning-pressure score
- Verification now reports both `sourceCoverageScore` and `verificationStrengthScore`

This is intentional transparency so the app does not claim precision where full cross-source automation is not yet complete.

The UI now exposes this more directly via:

- `All ranked areas` mode for broader exploration
- `High-confidence only` mode for a cleaner shortlist
- per-area trust badges and domain availability summaries

## Data pipeline

Pipeline entrypoint:

```bash
python3 -m pipeline.jobs.build_micro_areas
```

Refresh pollution metrics:

```bash
npm run pipeline:pollution
```

Refresh borough QoL (ONS APS) metrics:

```bash
npm run pipeline:wellbeing
```

Refresh transport metrics (TfL Journey Planner central-core + TfL StopPoint arrivals + OSRM with fallback):

```bash
npm run pipeline:transport
```

Refresh school metrics (DfE GIAS state-funded establishments + DfE EES KS2/KS4 performance):

```bash
npm run pipeline:schools
```

Refresh property metrics (current asking prices for semi-detached 3+ bed / 2+ bath homes, with sold-price fallback):

```bash
npm run pipeline:property
```

Run strict processed-dataset validation:

```bash
npm run pipeline:quality
```

Optional London high-resolution mode:
- If `data/external/LAEI2019-Concentrations-Data-CSV.zip` is present, London stations use LAEI 20m catchment calculations.
- If that archive is absent, London stations gracefully fall back to DEFRA LAQM 1km catchment values.

### Candidate generation process

1. Load the broader central-London-centred station universe.
2. Keep Greater London station areas within the configured central-London commute cap.
3. Deduplicate highly overlapping station micro-areas.
4. Build per-micro-area metrics via adapters.
   - Property metrics now prefer current asking prices for semi-detached homes with at least 3 bedrooms and 2 bathrooms, using public locality listing snapshots and distance-weighting back to the station area. If the direct station locality page is sparse, the pipeline can fall back to broader nearby locality pages only when the resulting listings still sit inside a bounded station-area radius. When current listing coverage is still too thin, the pipeline falls back to recent HM Land Registry semi-detached transactions, first on the tighter local catchment and then on an explicitly lower-confidence extended-area fallback.
   - If a station has no direct source record for a metric domain, the pipeline computes an explicit low-confidence estimate via inverse-distance interpolation from nearby anchor stations.
5. Compute component scores and weighted overall rank.
6. Persist `data/processed/micro_areas.json` and `data/processed/summary.json`.
7. Run strict quality checks and persist `data/processed/data_quality_report.json`.

Configuration lives in:

- `pipeline/config/search_config.json`

UI note:

- `/ranked` is the main Greater London shortlist view for the primary 70-minute commute universe.
- `/ranked-london` is now a coverage view over the same broader source universe, with most non-commute filters relaxed.
- The filter panel includes `Focus`, `Balanced`, and `Explore` presets. `Balanced` is the default first-run mode.
- Static GitHub Pages deployments keep clean URLs and copy `index.html` to `404.html` during build so deep links like `/micro-area/<id>` still boot the SPA correctly on refresh.

## Adapter architecture

Adapters are isolated per data domain in `pipeline/adapters/`:

- station / transport
- transport metrics (commute/drive/source-linked)
- property
- schools
- pollution
- green space
- crime
- population
- planning
- borough QoL (ONS APS personal well-being)

Current implementation uses `data/raw/` adapters so the app runs immediately with reproducible data files. Property metrics now prefer current asking prices for semi-detached homes with at least 3 bedrooms and 2 bathrooms, with recent sold-price fallback when live listing coverage is too thin. Pollution metrics use a dual-source approach: Greater London stations prefer LAEI 20m modelled catchment values with DEFRA 1km background cross-check fields, while non-London stations use DEFRA LAQM catchment values. Borough QoL metrics are sourced from ONS APS local authority personal well-being means.

School counts and school quality now both exclude private schools. Nearby primary and secondary totals and the school-quality composites come from state-funded-only DfE sources, and the school catchment is based on schools reachable within an approximately 20-minute road-adjusted drive-time proxy from each area anchor.

## Data quality model (no fake precision)

Each metric emitted to frontend includes:

- `status` (`available`, `estimated`, `placeholder`, `missing`)
- `provenance` (for example `direct_listing`, `direct_transactions`, `direct`, `interpolated`, `heuristic`)
- `confidence` (0-1)
- `methodologyNote`
- `lastUpdated`

Planning/development risk now comes from structured planning layers, but it is still a rule-based score rather than a direct planning-outcome feed.
Borough QoL is sourced from ONS APS local authority well-being means and linked by normalized local authority name.

In addition to per-metric metadata, a dataset-level audit runs on every build:

- hard range checks across key numeric fields
- schema + status/confidence sanity checks
- pollution raw-to-processed consistency checks
- London pollution cross-source delta checks (LAEI vs DEFRA background)

Critical failures stop the pipeline; warnings are surfaced in `data_quality_report.json` and the Overview page.

## CI / deploy gates

GitHub Actions now runs quality checks in the build/test/deploy path:

- `npm run lint`
- `npm run test`
- `python3 -m pytest`
- `npm run pipeline:quality`
- `npm run build`

Pages deploys only after those checks pass in the deploy workflow.

## Default scoring weights

- price: 32%
- transport / commute: 20%
- schools: 23%
- environment: 15%
- crime / safety: 10%

UI weights always normalize to 100%.

## Project structure

```text
.
├─ data/
│  ├─ raw/
│  └─ processed/
├─ pipeline/
│  ├─ adapters/
│  ├─ config/
│  ├─ jobs/
│  ├─ models/
│  └─ tests/
├─ src/
│  ├─ components/
│  ├─ context/
│  ├─ hooks/
│  ├─ lib/
│  ├─ pages/
│  └─ types/
├─ public/
├─ .github/workflows/
└─ AGENTS.md
```

## GitHub Actions workflows

- `test.yml`: frontend + pipeline tests
- `build.yml`: pipeline build + frontend production build
- `data-refresh.yml`: scheduled regeneration of `data/processed` and PR creation
- `data-refresh-heavy.yml`: monthly heavy refresh of station fixture, transport metrics, property metrics, pollution, wellbeing, and processed outputs
- `deploy.yml`: GitHub Pages deployment

## Deployment (GitHub Pages)

1. Enable Pages in repository settings (source: GitHub Actions).
2. Push to `main`.
3. `deploy.yml` builds the site and deploys `dist/`.

`vite.config.ts` automatically sets `base` for Pages when `GITHUB_PAGES=true`.

## Notes and assumptions

- Current pipeline is explicit about confidence, provenance, and mixed source maturity across domains.
- Commute metrics are partially live-sourced but still rely on snapshot queries and explicit fallback heuristics where TfL does not return journeys.
- Use this as an area-prioritization tool, then validate top areas with live market, school, transport, and planning checks.
