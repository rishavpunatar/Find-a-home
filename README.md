# Find a Home: Station-Centred Micro-Area Ranking

Static-first web app and pipeline that precomputes and ranks UK station-centred micro-areas around Pinner for buying a semi-detached house.

## What this app does

- Analyses all candidate station-centred micro-areas in a configurable search belt around Pinner.
- Models each micro-area as an 800m station walk catchment (configurable).
- Filters candidate stations by commute and drive constraints.
- Computes value, transport, schools, environment, crime, proximity, and planning-risk component scores.
- Links each micro-area to borough-level QoL from ONS APS personal well-being data.
- Produces an overall weighted ranking with confidence and data-status metadata.
- Lets you adjust weights and filters in the UI and inspect results in table, map, and chart views.
- Includes a London-wide tab that prioritizes breadth (commute-only filter, capped at 60 minutes).

## Stack

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
- London `<=60m` ranked tab (commute capped at 60 minutes, drive-to-Pinner filter disabled)
- Map view (colour by selected metric, detail side panel)
- Comparison view (up to 5 micro-areas)
- Micro-area detail page (raw metrics, statuses, confidence, explanations)
- Weight settings panel (local persistence + normalization)

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

This refreshes `data/raw/stations_transport.json` from live station geodata around Pinner and preserves seed records.

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

### 2f) Refresh property metrics from public 12-month transaction samples

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

- Crime: live cross-check against `data.police.uk` monthly incidents annualised per 1,000 (using denominator proxy)
- Pollution: dual-source model applied (`source_applied_model_cross_checked`)
- Property, schools, transport, greenspace, population: explicit `not_live_verified` status
- Planning risk: explicit `low_confidence_placeholder`

This is intentional transparency so the app does not claim precision where full cross-source automation is not yet complete.

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

Refresh transport metrics (TfL Journey Planner + OSRM with fallback):

```bash
npm run pipeline:transport
```

Refresh property metrics (HM Land Registry PPD + stratified catchment sampling):

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

1. Load broad station set in the configured search radius around Pinner.
2. Apply candidate constraints:
   - commute <= configured max
   - drive to Pinner <= configured max
3. Deduplicate highly overlapping station micro-areas.
4. Build per-micro-area metrics via adapters.
   - Property metrics use HM Land Registry PPD semi-detached transactions sampled over a rolling 12-month window from postcode strata inside each 800m catchment.
   - If a station has no direct source record for a metric domain, the pipeline computes an explicit low-confidence estimate via inverse-distance interpolation from nearby anchored stations.
5. Compute component scores and weighted overall rank.
6. Persist `data/processed/micro_areas.json` and `data/processed/summary.json`.
7. Run strict quality checks and persist `data/processed/data_quality_report.json`.

Configuration lives in:

- `pipeline/config/search_config.json`

UI note:

- `/ranked` keeps the standard Pinner-focused filtering model.
- `/ranked-london` uses a separate London-wide candidate scope (no Pinner-radius prefilter, no drive-to-Pinner candidate prefilter), then applies commute-only filtering in the UI (slider capped at 60 minutes).

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

Current implementation uses `data/raw/` adapters so the app runs immediately with reproducible data files. Property metrics use HM Land Registry PPD + stratified catchment postcode sampling. Pollution metrics use a dual-source approach: Greater London stations prefer LAEI 20m modelled catchment values with DEFRA 1km background cross-check fields, while non-London stations use DEFRA LAQM catchment values. Borough QoL metrics are sourced from ONS APS local authority personal well-being means. Some other domains remain fixture/interpolated in this MVP.

## Data quality model (no fake precision)

Each metric emitted to frontend includes:

- `status` (`available`, `estimated`, `placeholder`, `missing`)
- `confidence` (0-1)
- `methodologyNote`
- `lastUpdated`

Planning/development risk is intentionally marked as heuristic low-confidence unless a robust structured source is connected.
Borough QoL is sourced from ONS APS local authority well-being means and linked by normalized local authority name.

In addition to per-metric metadata, a dataset-level audit runs on every build:

- hard range checks across key numeric fields
- schema + status/confidence sanity checks
- pollution raw-to-processed consistency checks
- London pollution cross-source delta checks (LAEI vs DEFRA background)

Critical failures stop the pipeline; warnings are surfaced in `data_quality_report.json` and the Overview page.

## Default scoring weights

- value for money: 30%
- transport / commute: 15%
- schools: 20%
- environment: 15%
- crime / safety: 12.5%
- proximity to Pinner: 5%
- planning risk: 2.5%

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

- Current pipeline is MVP with explicit confidence/status metadata and mixed source maturity across domains.
- Commute and drive times are modelled proxies in this version.
- Use this as an area-prioritization tool, then validate top areas with live market, school, transport, and planning checks.
