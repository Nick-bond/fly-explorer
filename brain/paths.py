"""Shared locations for the brain subsystem."""

from __future__ import annotations

import json
from pathlib import Path

BRAIN_DIR = Path(__file__).resolve().parent
PROJECT_DIR = BRAIN_DIR.parent
DATA_DIR = PROJECT_DIR / "data"            # raw Codex downloads (.csv.gz)
BRAIN_DATA_DIR = PROJECT_DIR / "brain_data"  # preprocessed, optimized dataset
CONFIG_PATH = BRAIN_DIR / "config" / "brain.json"


def load_config(path: Path = CONFIG_PATH) -> dict:
    with open(path) as f:
        return json.load(f)
