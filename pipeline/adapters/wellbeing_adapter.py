from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from pipeline.adapters.base import WellbeingAdapter
from pipeline.adapters.json_loader import JsonFixtureLoader


def normalize_local_authority(name: str) -> str:
    normalized = name.lower().strip().replace('&', ' and ')
    normalized = re.sub(r'[^a-z0-9]+', ' ', normalized)
    normalized = re.sub(r'\s+', ' ', normalized).strip()

    for prefix in (
        'city and county of ',
        'city of ',
        'london borough of ',
        'royal borough of ',
        'metropolitan borough of ',
        'borough of ',
        'district of ',
        'the ',
    ):
        if normalized.startswith(prefix):
            normalized = normalized[len(prefix) :]

    for suffix in (' london borough', ' borough', ' district'):
        if normalized.endswith(suffix):
            normalized = normalized[: -len(suffix)]

    return re.sub(r'\s+', ' ', normalized).strip()


class FixtureWellbeingAdapter(WellbeingAdapter):
    def __init__(self, fixture_path: Path):
        payload: dict[str, Any] = JsonFixtureLoader(fixture_path).read()
        records = payload.get('records', []) if isinstance(payload, dict) else []

        self.source = payload.get('source', {}) if isinstance(payload, dict) else {}
        self.by_normalized_name: dict[str, dict[str, Any]] = {}

        for item in records:
            if not isinstance(item, dict):
                continue
            normalized = str(item.get('normalized_geography_name') or '').strip()
            geography_name = str(item.get('ons_geography_name') or '').strip()

            if normalized:
                self.by_normalized_name[normalized] = item
            if geography_name:
                self.by_normalized_name[normalize_local_authority(geography_name)] = item

    def get_by_local_authority(self, local_authority: str) -> dict[str, Any] | None:
        key = normalize_local_authority(local_authority)
        return self.by_normalized_name.get(key)
