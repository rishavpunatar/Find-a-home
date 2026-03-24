# AGENTS.md

This file tells coding agents how to work safely and consistently in this repository.

## Purpose

Build and maintain a static-first web app that ranks UK station-centred micro-areas around Pinner for semi-detached house search prioritisation.

## Core commands

- Install Node deps: `npm ci`
- Run app locally: `npm run dev`
- Build app: `npm run build`
- Run frontend tests: `npm run test`
- Lint TypeScript: `npm run lint`
- Format code: `npm run format`

## Pipeline commands

- Rebuild processed dataset: `python3 -m pipeline.jobs.build_micro_areas`
- Generate verification report: `python3 -m pipeline.jobs.verify_data_sources`
- Generate live verification report: `python3 -m pipeline.jobs.verify_data_sources --live`
- Run strict dataset quality audit: `python3 -m pipeline.jobs.validate_dataset --fail-on-critical`
- Run pipeline tests: `python3 -m pytest`

## Data flow

1. Raw fixture / source adapter inputs live in `data/raw/`
2. Pipeline writes compiled outputs to `data/processed/`
3. Frontend serves processed outputs from `public/data/processed/`
4. `npm run sync:data` copies `data/processed -> public/data/processed`

## Adapter extension guide

Adapters live in `pipeline/adapters/` with one adapter per data domain:

- `station_transport_adapter.py`
- `property_adapter.py`
- `school_adapter.py`
- `pollution_adapter.py`
- `green_space_adapter.py`
- `crime_adapter.py`
- `population_adapter.py`
- `planning_adapter.py`

To add a real data source:

1. Keep the interface method (`get_by_station` or `fetch_stations`) stable.
2. Create a new adapter class (for example `ApiPropertyAdapter`) beside the fixture adapter.
3. Return plain dictionaries matching existing expected keys in `build_micro_areas.py`.
4. Keep missing data explicit by returning `None` or a record with `status: placeholder` and low confidence.
5. Add/update tests in `pipeline/tests/`.
6. Document data licensing / rate limits / auth expectations in README.

## Scoring and honesty rules

- Do not silently fabricate missing values.
- Every metric must carry `status`, `confidence`, `methodologyNote`, `lastUpdated`.
- Planning/development risk remains a low-confidence heuristic until a robust source is integrated.

## CI expectations

Before opening a PR, run:

- `npm run test`
- `npm run lint`
- `python3 -m pytest`
- `npm run pipeline:quality`
- `npm run build`

## Frontend architecture expectations

- TypeScript strict mode must stay enabled.
- Domain types are in `src/types/domain.ts`; update there first when schema evolves.
- Ranking/filters logic is in `src/lib/` and must be unit-tested when changed.
