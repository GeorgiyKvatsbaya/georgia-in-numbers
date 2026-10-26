"""Data-quality gates run before publishing an export. Any failure blocks the refresh."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import duckdb

from .database import DEFAULT_DATABASE, DEFAULT_REGISTRY, load_registry
from .export import DEFAULT_OUTPUT
from .views import DERIVED_VIEWS

MAX_VALUE_DROP = 0.10
KEY_EXCLUDED = {
    "dataset", "value", "inflation_rate", "period_type", "period_start", "quarter_num",
    "month_num", "is_preliminary",
}


def table_stats(connection: duckdb.DuckDBPyConnection, name: str) -> tuple[int, Any]:
    columns = {row[0] for row in connection.execute(f"DESCRIBE {name}").fetchall()}
    measure = "value" if "value" in columns else None
    count = connection.execute(
        f"SELECT count({measure or '*'}) FROM {name}"
    ).fetchone()[0]
    last = None
    if "period_start" in columns:
        last = connection.execute(
            f"SELECT max(period_start) FROM {name} WHERE {measure or 'TRUE'} IS NOT NULL"
        ).fetchone()[0]
    return count, last


def run_checks(
    database: Path = DEFAULT_DATABASE,
    previous_catalog: Path = DEFAULT_OUTPUT / "catalog.json",
    registry_path: Path = DEFAULT_REGISTRY,
) -> list[str]:
    failures: list[str] = []
    previous = {}
    if previous_catalog.exists():
        catalog = json.loads(previous_catalog.read_text(encoding="utf-8"))
        previous = {entry["name"]: entry for entry in catalog["objects"]}

    with duckdb.connect(str(database), read_only=True) as connection:
        tables = [definition["table"] for definition in load_registry(registry_path).values()]
        existing = {
            row[0]
            for row in connection.execute(
                "SELECT table_name FROM duckdb_tables() WHERE schema_name = 'main' "
                "UNION ALL SELECT view_name FROM duckdb_views() "
                "WHERE NOT internal AND schema_name = 'main'"
            ).fetchall()
        }
        expected_views = [
            view for view, definition in DERIVED_VIEWS.items()
            if set(definition["requires"]) <= set(tables)
        ]
        for name in tables + expected_views:
            if name not in existing:
                failures.append(f"{name}: missing from the database")
                continue
            count, last = table_stats(connection, name)
            if count == 0:
                failures.append(f"{name}: no non-null values")
            if name in previous:
                before = previous[name]["value_count"]
                if before and count < before * (1 - MAX_VALUE_DROP):
                    failures.append(f"{name}: non-null values fell from {before} to {count}")
                before_last = previous[name].get("last_period")
                if before_last and last and str(last) < before_last:
                    failures.append(f"{name}: latest period went back from {before_last} to {last}")

        # Every source table must be unique on its dimension columns.
        for name in tables:
            if name not in existing:
                continue
            keys = [
                row[0]
                for row in connection.execute(f"DESCRIBE {name}").fetchall()
                if row[0] not in KEY_EXCLUDED
            ]
            duplicates = connection.execute(
                f"SELECT count(*) - count(DISTINCT ({', '.join(keys)})) FROM {name}"
            ).fetchone()[0]
            if duplicates:
                failures.append(f"{name}: {duplicates} duplicate rows on ({', '.join(keys)})")

        if "real_wages_quarterly" in existing:
            broken = connection.execute(
                """
                SELECT count(*) FROM real_wages_quarterly
                WHERE abs((1 + nominal_yoy_pct / 100)
                          - (1 + real_yoy_pct / 100) * (1 + cpi_yoy_pct / 100)) > 0.001
                """
            ).fetchone()[0]
            if broken:
                failures.append(f"real_wages_quarterly: {broken} rows break nominal = real × CPI")

        if "population_by_area" in existing:
            gaps = connection.execute(
                """
                SELECT count(*) FROM (
                    SELECT year,
                           sum(population_k) FILTER (WHERE area_level = 'region') AS regions,
                           max(population_k) FILTER (WHERE area_level = 'country') AS country
                    FROM population_by_area GROUP BY year
                ) WHERE regions IS NOT NULL AND country IS NOT NULL
                    AND abs(regions / country - 1) > 0.005
                """
            ).fetchone()[0]
            if gaps:
                failures.append(f"population_by_area: regions differ from country in {gaps} years")
    return failures
