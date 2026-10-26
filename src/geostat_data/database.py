from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import duckdb
import pandas as pd

from .client import GeostatClient

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_REGISTRY = PROJECT_ROOT / "datasets.json"
DEFAULT_DATABASE = PROJECT_ROOT / "data" / "geostat.duckdb"

# Derived views over registered tables. Each is (re)built after every sync once all of
# its source tables exist; the description is stored as the view's DuckDB comment.
DERIVED_VIEWS: dict[str, dict[str, Any]] = {
    "real_wages_quarterly": {
        "requires": ["salaries_quarterly", "cpi_index_monthly"],
        "description": (
            "Average monthly salary deflated by the national CPI (2010=100). One row per "
            "sex/sector × economic activity × year × period. period_type separates quarterly "
            "rows from Geostat's annual rows, which use a different method (annual runs "
            "3-5% below the mean of its quarters); never mix them. real_wage_index_2014 is "
            "100 at the 2014 mean of the same period_type. YoY compares the same quarter "
            "(or year) one year earlier. Real values are NULL until every CPI month of the "
            "period is published."
        ),
        "sql": """
            WITH month_numbers AS (
                SELECT * FROM (VALUES
                    ('I', 1), ('II', 2), ('III', 3), ('IV', 4), ('V', 5), ('VI', 6),
                    ('VII', 7), ('VIII', 8), ('IX', 9), ('X', 10), ('XI', 11), ('XII', 12)
                ) AS t(month, month_num)
            ),
            cpi_monthly AS (
                SELECT c.year, m.month_num, c.value AS cpi
                FROM cpi_index_monthly AS c
                JOIN month_numbers AS m USING (month)
                WHERE c.region = 'Georgia' AND c.value IS NOT NULL
            ),
            cpi_periods AS (
                SELECT
                    year,
                    'quarter' AS period_type,
                    (month_num + 2) // 3 AS quarter_num,
                    CASE WHEN count(*) = 3 THEN avg(cpi) END AS cpi
                FROM cpi_monthly
                GROUP BY year, (month_num + 2) // 3
                UNION ALL
                SELECT year, 'annual', NULL, CASE WHEN count(*) = 12 THEN avg(cpi) END
                FROM cpi_monthly
                GROUP BY year
            ),
            salaries AS (
                SELECT
                    sex_sectors,
                    economic_activity,
                    year,
                    quarter,
                    CASE quarter WHEN 'annual' THEN 'annual' ELSE 'quarter' END AS period_type,
                    CASE quarter WHEN 'I' THEN 1 WHEN 'II' THEN 2 WHEN 'III' THEN 3 WHEN 'IV' THEN 4
                    END AS quarter_num,
                    value AS nominal_salary_gel
                FROM salaries_quarterly
                WHERE value IS NOT NULL
            ),
            deflated AS (
                SELECT
                    s.*,
                    p.cpi AS cpi_2010_100,
                    s.nominal_salary_gel / (p.cpi / 100) AS real_salary_gel_2010
                FROM salaries AS s
                LEFT JOIN cpi_periods AS p
                    ON p.year = s.year
                    AND p.period_type = s.period_type
                    AND p.quarter_num IS NOT DISTINCT FROM s.quarter_num
            ),
            with_history AS (
                SELECT
                    *,
                    -- Base is the 2014 mean, only when every 2014 period of this type exists.
                    CASE
                        WHEN count(real_salary_gel_2010) FILTER (WHERE year = 2014) OVER series
                            = CASE period_type WHEN 'quarter' THEN 4 ELSE 1 END
                        THEN avg(real_salary_gel_2010) FILTER (WHERE year = 2014) OVER series
                    END AS base_real_salary,
                    lag(year) OVER same_period AS prior_year,
                    lag(nominal_salary_gel) OVER same_period AS prior_nominal,
                    lag(real_salary_gel_2010) OVER same_period AS prior_real,
                    lag(cpi_2010_100) OVER same_period AS prior_cpi
                FROM deflated
                WINDOW
                    series AS (PARTITION BY sex_sectors, economic_activity, period_type),
                    same_period AS (
                        PARTITION BY sex_sectors, economic_activity, period_type, quarter_num
                        ORDER BY year
                    )
            )
            SELECT
                sex_sectors,
                economic_activity,
                year,
                quarter,
                quarter_num,
                period_type,
                make_date(year::INTEGER, coalesce(quarter_num * 3 - 2, 1)::INTEGER, 1)
                    AS period_start,
                nominal_salary_gel,
                round(cpi_2010_100, 4) AS cpi_2010_100,
                round(real_salary_gel_2010, 2) AS real_salary_gel_2010,
                round(100 * real_salary_gel_2010 / base_real_salary, 4) AS real_wage_index_2014,
                CASE WHEN prior_year = year - 1
                    THEN round(100 * (nominal_salary_gel / prior_nominal - 1), 4)
                END AS nominal_yoy_pct,
                CASE WHEN prior_year = year - 1
                    THEN round(100 * (real_salary_gel_2010 / prior_real - 1), 4)
                END AS real_yoy_pct,
                CASE WHEN prior_year = year - 1
                    THEN round(100 * (cpi_2010_100 / prior_cpi - 1), 4)
                END AS cpi_yoy_pct
            FROM with_history
        """,
    },
}


def load_registry(path: Path = DEFAULT_REGISTRY) -> dict[str, dict[str, str]]:
    return json.loads(path.read_text(encoding="utf-8"))


def sql_name(value: str) -> str:
    value = re.sub(r"[^a-z0-9]+", "_", value.lower()).strip("_")
    aliases = {
        "years": "year",
        "quarters": "quarter",
        "regions": "region",
        "groups": "consumption_group",
    }
    return aliases.get(value, value or "dimension")


def prepare_frame(frame: pd.DataFrame, dataset: str) -> pd.DataFrame:
    result = frame.rename(columns={column: sql_name(column) for column in frame.columns})
    result.insert(0, "dataset", dataset)
    if "year" in result:
        result["year"] = pd.to_numeric(result["year"], errors="coerce").astype("Int64")
    if dataset == "inflation":
        result["inflation_rate"] = (result["value"] - 100).round(4)
    return result


def initialize(connection: duckdb.DuckDBPyConnection) -> None:
    connection.execute("CREATE SCHEMA IF NOT EXISTS metadata")
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS metadata.datasets (
            dataset VARCHAR PRIMARY KEY,
            table_name VARCHAR NOT NULL,
            title VARCHAR,
            description VARCHAR,
            grain VARCHAR,
            unit VARCHAR,
            source VARCHAR,
            source_url VARCHAR,
            source_path VARCHAR,
            source_language VARCHAR,
            retrieved_at TIMESTAMPTZ,
            row_count BIGINT
        )
        """
    )
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS metadata.dimensions (
            dataset VARCHAR,
            source_code VARCHAR,
            column_name VARCHAR,
            label VARCHAR,
            value_id VARCHAR,
            value_label VARCHAR
        )
        """
    )


def sync_dataset(
    dataset: str,
    database: Path = DEFAULT_DATABASE,
    registry_path: Path = DEFAULT_REGISTRY,
    language: str = "en",
) -> int:
    registry = load_registry(registry_path)
    if dataset not in registry:
        raise KeyError(f"Unknown dataset {dataset!r}. Choose from: {', '.join(registry)}")
    definition = registry[dataset]
    client = GeostatClient(language=language)
    metadata = client.metadata(definition["path"])
    frame, provenance = client.fetch(definition["path"])
    frame = prepare_frame(frame, dataset)

    database.parent.mkdir(parents=True, exist_ok=True)
    with duckdb.connect(str(database)) as connection:
        initialize(connection)
        connection.register("incoming_frame", frame)
        connection.execute(f"CREATE OR REPLACE TABLE {definition['table']} AS SELECT * FROM incoming_frame")
        connection.execute("DELETE FROM metadata.datasets WHERE dataset = ?", [dataset])
        connection.execute(
            """
            INSERT INTO metadata.datasets VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                dataset,
                definition["table"],
                metadata.get("title"),
                definition["description"],
                definition["grain"],
                definition["unit"],
                provenance["source"],
                provenance["source_url"],
                definition["path"],
                language,
                provenance["retrieved_at"],
                len(frame),
            ],
        )
        connection.execute("DELETE FROM metadata.dimensions WHERE dataset = ?", [dataset])
        dimension_rows: list[list[Any]] = []
        for variable in metadata["variables"]:
            for value_id, value_label in zip(variable["values"], variable["valueTexts"]):
                dimension_rows.append(
                    [
                        dataset,
                        variable["code"],
                        sql_name(variable["code"]),
                        variable["text"],
                        value_id,
                        value_label,
                    ]
                )
        connection.executemany(
            "INSERT INTO metadata.dimensions VALUES (?, ?, ?, ?, ?, ?)", dimension_rows
        )
        refresh_views(connection)
    return len(frame)


def refresh_views(connection: duckdb.DuckDBPyConnection) -> list[str]:
    """Create or replace every derived view whose source tables are all present."""
    tables = {
        row[0]
        for row in connection.execute(
            "SELECT table_name FROM duckdb_tables() WHERE schema_name = 'main'"
        ).fetchall()
    }
    built = []
    for name, view in DERIVED_VIEWS.items():
        if not set(view["requires"]) <= tables:
            continue
        connection.execute(f"CREATE OR REPLACE VIEW {name} AS {view['sql']}")
        # COMMENT ON does not accept bind parameters.
        comment = view["description"].replace("'", "''")
        connection.execute(f"COMMENT ON VIEW {name} IS '{comment}'")
        built.append(name)
    return built


def database_overview(database: Path = DEFAULT_DATABASE) -> str:
    if not database.exists():
        return "Database does not exist yet. Run: geostat sync <dataset>"
    with duckdb.connect(str(database), read_only=True) as connection:
        rows = connection.execute(
            "SELECT dataset, table_name, description, grain, unit, row_count, retrieved_at "
            "FROM metadata.datasets ORDER BY dataset"
        ).fetchall()
        views = connection.execute(
            "SELECT view_name, comment FROM duckdb_views() "
            "WHERE NOT internal AND schema_name = 'main' ORDER BY view_name"
        ).fetchall()
    if not rows:
        return "Database exists but contains no registered datasets."
    lines = ["DATASETS"]
    for dataset, table, description, grain, unit, count, retrieved in rows:
        lines.extend(
            [
                f"\n{dataset} -> {table}",
                f"  Description: {description}",
                f"  Grain: {grain}",
                f"  Unit: {unit}",
                f"  Rows: {count}; retrieved: {retrieved}",
            ]
        )
    if views:
        lines.append("\nDERIVED VIEWS")
        for name, comment in views:
            lines.extend([f"\n{name}", f"  {comment}"])
    return "\n".join(lines)
