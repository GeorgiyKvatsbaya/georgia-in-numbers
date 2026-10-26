"""Export the database as static files for the web app: Parquet, catalog.json, dashboards."""

from __future__ import annotations

import json
import math
import re
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any

import duckdb

from .database import DEFAULT_DATABASE, DEFAULT_REGISTRY, PROJECT_ROOT, load_registry
from .views import DERIVED_VIEWS, VIEW_META

DEFAULT_OUTPUT = PROJECT_ROOT / "web" / "public" / "data"
I18N_DIR = PROJECT_ROOT / "i18n"
LANGUAGES = ["en", "ka", "ru"]
TIME_COLUMNS = {
    "year", "quarter", "month", "period", "period_type", "period_start",
    "quarter_num", "month_num", "is_preliminary",
}
HIDDEN_COLUMNS = {"dataset", "source_order"}
NUMERIC_TYPES = ("DOUBLE", "FLOAT", "BIGINT", "INTEGER", "DECIMAL", "HUGEINT", "SMALLINT")

# Small, chart-ready series per dashboard topic. Each query result becomes one JSON array.
DASHBOARDS: dict[str, dict[str, str]] = {
    "home": {
        "inflation": """
            SELECT period_start, inflation_yoy_pct AS value
            FROM inflation_monthly
            WHERE inflation_yoy_pct IS NOT NULL AND period_start >= DATE '2018-01-01'
            ORDER BY period_start""",
        "real_wages": """
            SELECT period_start, real_yoy_pct AS value
            FROM real_wages_quarterly
            WHERE sex_sectors = 'Total in country' AND economic_activity = 'Total'
              AND period_type = 'quarter' AND real_yoy_pct IS NOT NULL
            ORDER BY period_start""",
        "unemployment": """
            SELECT period_start, unemployment_rate_pct AS value
            FROM labour_quarterly
            WHERE population_group = 'Total' AND period_type = 'quarter'
              AND unemployment_rate_pct IS NOT NULL AND period_start >= DATE '2017-01-01'
            ORDER BY period_start""",
        "gdp_growth": """
            SELECT period_start, real_growth_pct AS value, is_preliminary
            FROM gdp_headline
            WHERE period_type = 'quarter' AND real_growth_pct IS NOT NULL
              AND period_start >= DATE '2017-01-01'
            ORDER BY period_start""",
        "population": """
            SELECT period_start, population_k AS value
            FROM population_by_area
            WHERE area_level = 'country' AND period_start >= DATE '2010-01-01'
            ORDER BY period_start""",
        "exchange_rate": """
            SELECT period_start, gel_per_usd AS value, is_preliminary
            FROM gdp_headline
            WHERE period_type = 'quarter' AND gel_per_usd IS NOT NULL
              AND period_start >= DATE '2017-01-01'
            ORDER BY period_start""",
    },
    "prices": {
        "headline": """
            SELECT period_start, cpi_2010_100, inflation_mom_pct, inflation_yoy_pct
            FROM inflation_monthly
            WHERE period_start >= DATE '2010-01-01'
            ORDER BY period_start""",
        "by_group": """
            SELECT consumption_group, period_start, round(inflation_rate, 2) AS inflation_yoy_pct
            FROM inflation_yoy_monthly
            WHERE region = 'Georgia' AND value IS NOT NULL
              AND period_start >= (SELECT max(period_start) FROM inflation_yoy_monthly
                                   WHERE value IS NOT NULL) - INTERVAL 35 MONTH
            ORDER BY consumption_group, period_start""",
        "by_city": """
            SELECT region, period_start, round(inflation_rate, 2) AS inflation_yoy_pct
            FROM inflation_yoy_monthly
            WHERE consumption_group = 'Total' AND value IS NOT NULL
              AND period_start >= DATE '2018-01-01'
            ORDER BY region, period_start""",
        "property": """
            SELECT dwelling_type, period_start, value AS rppi_2020_100
            FROM property_prices_quarterly
            WHERE value IS NOT NULL
            ORDER BY dwelling_type, period_start""",
    },
    "wages": {
        "headline": """
            SELECT period_start, nominal_salary_gel, real_salary_gel_2010, real_wage_index_2014,
                   nominal_yoy_pct, cpi_yoy_pct, real_yoy_pct
            FROM real_wages_quarterly
            WHERE sex_sectors = 'Total in country' AND economic_activity = 'Total'
              AND period_type = 'quarter'
            ORDER BY period_start""",
        "by_activity": """
            WITH latest AS (
                SELECT max(period_start) AS period_start FROM real_wages_quarterly
                WHERE period_type = 'quarter' AND real_yoy_pct IS NOT NULL
            )
            SELECT economic_activity, period_start, nominal_salary_gel, real_yoy_pct
            FROM real_wages_quarterly JOIN latest USING (period_start)
            WHERE sex_sectors = 'Total in country' AND period_type = 'quarter'
              AND economic_activity <> 'Total'
            ORDER BY nominal_salary_gel DESC""",
        "by_sex": """
            SELECT sex_sectors AS sex, period_start, nominal_salary_gel
            FROM real_wages_quarterly
            WHERE sex_sectors IN ('Female', 'Male') AND economic_activity = 'Total'
              AND period_type = 'quarter'
            ORDER BY sex, period_start""",
        "by_region": """
            WITH latest AS (
                SELECT max(period_start) AS period_start FROM salaries_regional
                WHERE period_type = 'quarter' AND value IS NOT NULL
            )
            SELECT region, period_start, value AS nominal_salary_gel
            FROM salaries_regional JOIN latest USING (period_start)
            WHERE period_type = 'quarter' AND value IS NOT NULL
            ORDER BY value DESC""",
    },
    "labour": {
        "headline": """
            SELECT population_group, period_start, unemployment_rate_pct,
                   participation_rate_pct, employment_rate_pct, employed_k, unemployed_k
            FROM labour_quarterly
            WHERE period_type = 'quarter' AND period_start >= DATE '2017-01-01'
            ORDER BY population_group, period_start""",
        "by_region": """
            SELECT region, year, unemployment_rate_pct, participation_rate_pct, employment_rate_pct
            FROM labour_regional_annual
            WHERE year >= 2017
            ORDER BY region, year""",
    },
    "economy": {
        "quarterly": """
            SELECT period_start, is_preliminary, gdp_mln_gel, gdp_mln_usd, real_growth_pct,
                   deflator_pct, gel_per_usd
            FROM gdp_headline
            WHERE period_type = 'quarter'
            ORDER BY period_start""",
        "annual": """
            SELECT year, is_preliminary, gdp_mln_gel, gdp_mln_usd, gdp_per_capita_gel,
                   gdp_per_capita_usd, real_growth_pct
            FROM gdp_headline
            WHERE period_type = 'annual'
            ORDER BY year""",
        "by_activity": """
            WITH latest AS (
                SELECT max(year) AS year FROM gdp_by_activity WHERE period_type = 'annual'
            )
            SELECT nace_section, activity, year, is_preliminary, gva_mln_gel, share_of_gva_pct,
                   real_growth_pct
            FROM gdp_by_activity JOIN latest USING (year)
            WHERE period_type = 'annual'
            ORDER BY gva_mln_gel DESC""",
        "fdi": """
            SELECT year, period_type, quarter_num, period_start, round(value / 1e6, 2) AS fdi_mln_usd
            FROM fdi_quarterly
            WHERE sources = 'Total' AND value IS NOT NULL
            ORDER BY period_type, period_start""",
    },
    "trade": {
        "quarterly": """
            SELECT period_start, is_preliminary, exports_goods_mln_gel, exports_services_mln_gel,
                   imports_goods_mln_gel, imports_services_mln_gel, exports_mln_gel,
                   imports_mln_gel, net_exports_mln_gel, gel_per_usd
            FROM gdp_headline
            WHERE period_type = 'quarter' AND exports_mln_gel IS NOT NULL
            ORDER BY period_start""",
        "annual": """
            SELECT year, is_preliminary, exports_mln_gel, imports_mln_gel, net_exports_mln_gel,
                   round(100 * exports_mln_gel / gdp_mln_gel, 2) AS exports_share_of_gdp_pct,
                   round(100 * imports_mln_gel / gdp_mln_gel, 2) AS imports_share_of_gdp_pct
            FROM gdp_headline
            WHERE period_type = 'annual' AND exports_mln_gel IS NOT NULL
            ORDER BY year""",
    },
    "population": {
        "total": """
            SELECT year, population_k FROM population_by_area
            WHERE area_level = 'country' ORDER BY year""",
        "by_region": """
            SELECT area AS region, year, population_k FROM population_by_area
            WHERE area_level = 'region'
              AND year IN ((SELECT max(year) FROM population_by_area),
                           (SELECT max(year) FROM population_by_area) - 10)
            ORDER BY source_order, year""",
        "pyramid": """
            SELECT age, sex, year, value AS population_k
            FROM population_age_sex
            WHERE age <> 'Total' AND sex <> 'Both Sexes' AND value IS NOT NULL
              AND year IN ((SELECT max(year) FROM population_age_sex), 1994)
            ORDER BY year, sex, age""",
        "poverty": """
            SELECT population_group, year, value AS poverty_rate_pct
            FROM poverty_absolute WHERE value IS NOT NULL
            ORDER BY population_group, year""",
    },
}


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}


def is_usable_label(label: str | None) -> bool:
    """Geostat sometimes returns mis-encoded Georgian text as runs of underscores or '?'."""
    if not label:
        return False
    junk = sum(ch in "_?" for ch in label)
    return junk / len(label) < 0.3


def label_maps(connection: duckdb.DuckDBPyConnection) -> dict[str, dict[str, str]]:
    """English label -> translation, for each non-English UI language."""
    ka: dict[str, str] = {}
    for en_label, ka_label in connection.execute(
        """
        SELECT en.value_label, ka.value_label
        FROM metadata.dimensions AS en
        JOIN metadata.dimensions AS ka
            USING (dataset, column_name, value_id)
        WHERE en.language = 'en' AND ka.language = 'ka'
        """
    ).fetchall():
        if is_usable_label(ka_label):
            ka.setdefault(en_label, ka_label)
            # Views strip the NACE letter ("A Agriculture…" -> "Agriculture…"); mirror that.
            if re.match(r"^[A-T] ", en_label) and re.match(r"^[A-T] ", ka_label):
                ka.setdefault(en_label[2:], ka_label[2:])
    ka.update(load_json(I18N_DIR / "labels_ka.json"))
    return {"ka": ka, "ru": load_json(I18N_DIR / "labels_ru.json")}


def translate(value: str, maps: dict[str, dict[str, str]]) -> dict[str, str]:
    return {"en": value, **{lang: maps[lang].get(value, value) for lang in maps}}


def json_value(value: Any) -> Any:
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
        return None
    return value


def query_table(connection: duckdb.DuckDBPyConnection, sql: str) -> dict[str, Any]:
    """Column names plus row arrays: far smaller than repeating keys on every row."""
    cursor = connection.execute(sql)
    return {
        "columns": [column[0] for column in cursor.description],
        "rows": [[json_value(value) for value in row] for row in cursor.fetchall()],
    }


def describe_object(
    connection: duckdb.DuckDBPyConnection,
    name: str,
    maps: dict[str, dict[str, str]],
    column_labels: dict[str, dict[str, str]],
    dataset: str | None,
) -> dict[str, Any]:
    columns = []
    for column, column_type, *_ in connection.execute(f"DESCRIBE {name}").fetchall():
        if column in HIDDEN_COLUMNS:
            continue
        if column in TIME_COLUMNS:
            role = "time"
        elif column_type.startswith(NUMERIC_TYPES):
            role = "measure"
        else:
            role = "dimension"
        entry: dict[str, Any] = {
            "name": column,
            "type": column_type,
            "role": role,
            "label": column_labels.get(column, {lang: column for lang in LANGUAGES}),
        }
        if role == "dimension":
            # Keep Geostat's own ordering when the column maps to a source dimension.
            order = {}
            if dataset:
                order = dict(
                    connection.execute(
                        "SELECT value_label, min(try_cast(value_id AS INTEGER)) "
                        "FROM metadata.dimensions WHERE dataset = ? AND column_name = ? "
                        "AND language = 'en' GROUP BY 1",
                        [dataset, column],
                    ).fetchall()
                )
            values = [
                row[0]
                for row in connection.execute(
                    f'SELECT DISTINCT "{column}" FROM {name} WHERE "{column}" IS NOT NULL'
                ).fetchall()
            ]
            values.sort(key=lambda value: (order.get(value, 10**6), value))
            entry["values"] = [translate(value, maps) for value in values]
        columns.append(entry)
    measure = "value" if any(c["name"] == "value" for c in columns) else None
    count_expr = f"count({measure})" if measure else "count(*)"
    has_period = any(c["name"] == "period_start" for c in columns)
    stats = connection.execute(
        f"SELECT count(*), {count_expr}"
        + (
            f", min(period_start) FILTER (WHERE {measure or 'TRUE'} IS NOT NULL), "
            f"max(period_start) FILTER (WHERE {measure or 'TRUE'} IS NOT NULL) "
            if has_period
            else ", NULL, NULL "
        )
        + f"FROM {name}"
    ).fetchone()
    return {
        "columns": columns,
        "row_count": stats[0],
        "value_count": stats[1],
        "first_period": json_value(stats[2]),
        "last_period": json_value(stats[3]),
    }


def export(
    database: Path = DEFAULT_DATABASE,
    output: Path = DEFAULT_OUTPUT,
    registry_path: Path = DEFAULT_REGISTRY,
    dashboards: dict[str, dict[str, str]] | None = None,
) -> dict[str, Any]:
    registry = load_registry(registry_path)
    dashboards = DASHBOARDS if dashboards is None else dashboards
    column_labels = load_json(I18N_DIR / "columns.json")
    output.mkdir(parents=True, exist_ok=True)
    (output / "dashboards").mkdir(exist_ok=True)

    with duckdb.connect(str(database), read_only=True) as connection:
        maps = label_maps(connection)
        metadata = {
            row[0]: row
            for row in connection.execute(
                "SELECT dataset, table_name, source_url, source_path, retrieved_at "
                "FROM metadata.datasets"
            ).fetchall()
        }
        existing_views = {
            row[0]
            for row in connection.execute(
                "SELECT view_name FROM duckdb_views() WHERE NOT internal AND schema_name = 'main'"
            ).fetchall()
        }

        entries = []
        for dataset, definition in registry.items():
            if dataset not in metadata:
                continue
            _, table, source_url, source_path, retrieved_at = metadata[dataset]
            entries.append(
                {
                    "name": table,
                    "kind": "table",
                    "dataset": dataset,
                    "topic": definition.get("topic"),
                    "title": definition["title"],
                    "description": definition["description"],
                    "unit": definition["unit"],
                    "grain": definition["grain"],
                    "sources": [
                        {"url": source_url, "path": source_path, "retrieved_at": json_value(retrieved_at)}
                    ],
                    **describe_object(connection, table, maps, column_labels, dataset),
                }
            )
        tables_by_name = {entry["name"]: entry for entry in entries}
        for view, definition in DERIVED_VIEWS.items():
            if view not in existing_views:
                continue
            meta = VIEW_META[view]
            entries.append(
                {
                    "name": view,
                    "kind": "view",
                    "dataset": None,
                    "topic": meta["topic"],
                    "title": meta["title"],
                    "description": {**meta["summary"], "en_detail": definition["description"]},
                    "unit": None,
                    "grain": None,
                    "requires": definition["requires"],
                    "sources": [
                        source
                        for table in definition["requires"]
                        for source in tables_by_name[table]["sources"]
                    ],
                    **describe_object(connection, view, maps, column_labels, None),
                }
            )

        for entry in entries:
            target = output / f"{entry['name']}.parquet"
            # COPY cannot take a bind parameter for its target path.
            connection.execute(
                f"COPY (SELECT * EXCLUDE (dataset) FROM {entry['name']}) "
                f"TO '{target.as_posix()}' (FORMAT parquet, COMPRESSION zstd)"
                if entry["kind"] == "table"
                else f"COPY (SELECT * FROM {entry['name']}) "
                f"TO '{target.as_posix()}' (FORMAT parquet, COMPRESSION zstd)"
            )
            entry["file"] = target.name
            entry["bytes"] = target.stat().st_size

        retrieved = [
            source["retrieved_at"] for entry in entries for source in entry["sources"]
        ]
        for topic, queries in dashboards.items():
            payload = {
                "topic": topic,
                "retrieved_at": max(retrieved) if retrieved else None,
                "series": {name: query_table(connection, sql) for name, sql in queries.items()},
            }
            (output / "dashboards" / f"{topic}.json").write_text(
                json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
            )

    catalog = {
        "generated_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "source": {
            "name": {
                "en": "National Statistics Office of Georgia (Geostat)",
                "ka": "საქართველოს სტატისტიკის ეროვნული სამსახური (საქსტატი)",
                "ru": "Национальная служба статистики Грузии (Сакстат)",
            },
            "url": "https://www.geostat.ge/",
        },
        "languages": LANGUAGES,
        "objects": entries,
    }
    (output / "catalog.json").write_text(
        json.dumps(catalog, ensure_ascii=False, indent=1), encoding="utf-8"
    )
    return catalog
