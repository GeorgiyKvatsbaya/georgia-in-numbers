from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import quote

import pandas as pd
import requests


@dataclass(frozen=True)
class GeostatClient:
    """Small client for Geostat's public PXWeb API."""

    language: str = "en"
    timeout: int = 60
    base_url: str = "https://pc-axis.geostat.ge/PXWeb/api/v1"

    def _url(self, path: str = "") -> str:
        parts = [self.base_url.rstrip("/"), quote(self.language), "Database"]
        parts.extend(quote(part, safe="") for part in path.strip("/").split("/") if part)
        url = "/".join(parts)
        # Geostat's IIS front end returns 404 for table URLs ending in ".px"
        # (observed 2026-10); the same URL with a trailing slash is served normally.
        return f"{url}/" if url.lower().endswith(".px") else url

    def catalog(self, path: str = "") -> list[dict[str, Any]]:
        response = requests.get(self._url(path), timeout=self.timeout)
        response.raise_for_status()
        return response.json()

    def metadata(self, table_path: str) -> dict[str, Any]:
        response = requests.get(self._url(table_path), timeout=self.timeout)
        response.raise_for_status()
        return response.json()

    def fetch(
        self,
        table_path: str,
        selections: dict[str, list[str]] | None = None,
    ) -> tuple[pd.DataFrame, dict[str, Any]]:
        """Fetch a table. Selection values are PXWeb value IDs, not labels."""
        metadata = self.metadata(table_path)
        selections = selections or {}
        query = []
        for variable in metadata["variables"]:
            code = variable["code"]
            values = selections.get(code)
            query.append(
                {
                    "code": code,
                    "selection": (
                        {"filter": "item", "values": values}
                        if values
                        else {"filter": "all", "values": ["*"]}
                    ),
                }
            )

        response = requests.post(
            self._url(table_path),
            # Geostat's PXWeb installation supports JSON-stat 1, but currently
            # returns HTTP 404 for the newer json-stat2 response format.
            json={"query": query, "response": {"format": "json-stat"}},
            timeout=self.timeout,
        )
        response.raise_for_status()
        payload = response.json()
        frame = jsonstat_to_frame(payload)
        provenance = {
            "source": "National Statistics Office of Georgia (Geostat)",
            "source_url": self._url(table_path),
            "table_path": table_path,
            "title": metadata.get("title", table_path),
            "language": self.language,
            "retrieved_at": datetime.now(timezone.utc).isoformat(),
            "selections": selections,
            "rows": len(frame),
        }
        return frame, provenance

    def save(
        self,
        table_path: str,
        output: Path,
        selections: dict[str, list[str]] | None = None,
    ) -> tuple[Path, Path]:
        frame, provenance = self.fetch(table_path, selections)
        output.parent.mkdir(parents=True, exist_ok=True)
        frame.to_csv(output, index=False)
        metadata_path = output.with_suffix(".metadata.json")
        metadata_path.write_text(
            json.dumps(provenance, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        return output, metadata_path


def jsonstat_to_frame(payload: dict[str, Any]) -> pd.DataFrame:
    """Convert a dense JSON-stat 1 or 2 dataset into a tidy DataFrame."""
    payload = payload.get("dataset", payload)
    dimension_block = payload["dimension"]
    dimensions = payload.get("id", dimension_block.get("id"))
    sizes = payload.get("size", dimension_block.get("size"))
    labels: list[list[str]] = []
    for dimension in dimensions:
        category = dimension_block[dimension]["category"]
        index = category["index"]
        ordered = (
            sorted(index, key=index.get) if isinstance(index, dict) else list(index)
        )
        label_map = category.get("label", {})
        labels.append([label_map.get(value, value) for value in ordered])

    index = pd.MultiIndex.from_product(labels, names=dimensions)
    values = payload.get("value", [])
    if isinstance(values, dict):
        dense_values = [values.get(str(position)) for position in range(len(index))]
    else:
        dense_values = values
    if len(dense_values) != len(index):
        raise ValueError(f"Expected {len(index)} values from dimensions {sizes}, got {len(dense_values)}")
    frame = pd.DataFrame({"value": dense_values}, index=index).reset_index()
    frame["value"] = pd.to_numeric(frame["value"], errors="coerce")
    return frame
