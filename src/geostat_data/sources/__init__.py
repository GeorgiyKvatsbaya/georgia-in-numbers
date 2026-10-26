"""Adapters for Geostat sources other than PXWeb (prices portal API, GeoMap API)."""

from __future__ import annotations

from dataclasses import dataclass, field

import pandas as pd


@dataclass
class SourceResult:
    """What every adapter returns; `sync_dataset` stores it like a PXWeb table.

    `labels` rows are (column, value_id, english, georgian) for dimension values, written to
    `metadata.dimensions` so the web export can translate them.
    """

    frame: pd.DataFrame
    source_url: str
    source_path: str
    labels: list[tuple[str, str, str, str]] = field(default_factory=list)
