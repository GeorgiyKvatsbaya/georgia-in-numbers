"""Data-quality gates run before publishing an export. Any failure blocks the refresh."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import duckdb

from .client import GeostatClient
from .database import DEFAULT_DATABASE, DEFAULT_REGISTRY, load_registry
from .export import DEFAULT_OUTPUT
from .views import DERIVED_VIEWS

MAX_VALUE_DROP = 0.10
MIN_PRODUCTS = 95
DEFAULT_GEO = DEFAULT_OUTPUT / "geo"
# (table, code column, boundary layer, row filter)
GEO_JOINS = [
    ("business_regional_annual", "region_code", "regions", "TRUE"),
    ("business_by_area", "area_code", "municipalities", "area_level = 'municipality'"),
    ("tbilisi_property_quarterly", "district", "tbilisi_districts", "TRUE"),
]
CROSS_SOURCE_YEAR = 2022
CROSS_SOURCE_TABLES = {
    "Turnover, million GEL": "Turnover",
    "Average monthly remuneration, GEL": "Average Monthly Earnings",
    "Employees": "Number of Employees",
    "Persons employed": "Number of Persons Employed",
}
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
    cross_source: bool = False,
    geo_directory: Path | None = None,
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

        if "retail_prices_latest" in existing:
            products = connection.execute(
                "SELECT count(*) FROM retail_prices_latest WHERE price_gel IS NOT NULL"
            ).fetchone()[0]
            if products < MIN_PRODUCTS:
                failures.append(f"retail_prices_latest: only {products} products have a price")

        if {"inflation_measures_monthly", "inflation_monthly"} <= existing:
            # The prices portal and PXWeb publish the same headline CPI; they must agree.
            mismatches = connection.execute(
                """
                SELECT count(*) FROM inflation_measures_monthly AS m
                JOIN inflation_monthly AS p USING (period_start)
                WHERE m.measure = 'Headline CPI inflation'
                  -- PXWeb rounds older months to 0.1, so allow half a rounding step.
                  AND abs(m.value - p.inflation_yoy_pct) > 0.051
                """
            ).fetchone()[0]
            if mismatches:
                failures.append(f"inflation_measures_monthly: {mismatches} months differ from PXWeb CPI")

        failures += geo_failures(connection, existing, geo_directory or DEFAULT_GEO)
        if cross_source and "business_regional_annual" in existing:
            failures += cross_source_failures(connection)
    return failures


def geo_failures(connection: duckdb.DuckDBPyConnection, existing: set[str], directory: Path) -> list[str]:
    """Every area code used by the data must exist in the committed map boundaries."""
    failures = []
    for table, column, layer, where in GEO_JOINS:
        path = directory / f"{layer}.json"
        if table not in existing or not path.exists():
            continue
        ids = {f["properties"]["id"] for f in json.loads(path.read_text(encoding="utf-8"))["features"]}
        codes = {
            row[0]
            for row in connection.execute(
                f"SELECT DISTINCT {column} FROM {table} WHERE {where}"
            ).fetchall()
        }
        missing = sorted(codes - ids)
        if missing:
            failures.append(f"{table}: codes missing from {layer}.json: {missing}")
    return failures


def cross_source_failures(connection: duckdb.DuckDBPyConnection) -> list[str]:
    """GeoMap regional figures must equal PXWeb Business Statistics (network request)."""
    failures = []
    client = GeostatClient()
    for indicator, folder in CROSS_SOURCE_TABLES.items():
        items = client.catalog(f"Business Statistics/{folder}")
        table = next(item["id"] for item in items if item["type"] == "t" and "egion" in item["id"])
        path = f"Business Statistics/{folder}/{table}"
        metadata = client.metadata(path)
        period = next(v for v in metadata["variables"] if v["code"].lower().startswith("period"))
        year = str(CROSS_SOURCE_YEAR)
        frame, _ = client.fetch(path, {period["code"]: [period["values"][period["valueTexts"].index(year)]]})
        published = frame.set_index(frame.columns[1])["value"].to_dict()
        ours = dict(
            connection.execute(
                "SELECT region, value FROM business_regional_annual WHERE indicator = ? AND year = ?",
                [indicator, CROSS_SOURCE_YEAR],
            ).fetchall()
        )
        for region, pxweb_region in [("Adjara A.R.", "Adjara AR"), ("Imereti", "Imereti")]:
            if (
                region in ours
                and pxweb_region in published
                and abs(ours[region] - published[pxweb_region]) > 0.6
            ):
                failures.append(
                    f"business_regional_annual: {indicator} {region} {CROSS_SOURCE_YEAR} = "
                    f"{ours[region]} but PXWeb has {published[pxweb_region]}"
                )
    return failures
