from __future__ import annotations

import json
from pathlib import Path
from typing import Any


class JsonFixtureLoader:
    def __init__(self, fixture_path: Path):
        self.fixture_path = fixture_path

    def read(self) -> Any:
        with self.fixture_path.open('r', encoding='utf-8') as file:
            return json.load(file)
