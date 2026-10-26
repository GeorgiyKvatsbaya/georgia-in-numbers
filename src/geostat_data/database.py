from __future__ import annotations

import json
import re
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import duckdb
import pandas as pd

from .client import GeostatClient
from .sources import gis_api, prices_api
from .views import refresh_views

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_REGISTRY = PROJECT_ROOT / "datasets.json"
DEFAULT_DATABASE = PROJECT_ROOT / "data" / "geostat.duckdb"

def load_registry(path: Path = DEFAULT_REGISTRY) -> dict[str, dict[str, Any]]:
    return json.loads(path.read_text(encoding="utf-8"))


def localized(definition: dict[str, Any], key: str, language: str = "en") -> str | None:
    """Registry text fields are either a plain string or a {language: text} mapping."""
    value = definition.get(key)
    if isinstance(value, dict):
        return value.get(language) or value.get("en")
    return value


def sql_name(value: str) -> str:
    value = re.sub(r"[^a-z0-9]+", "_", value.lower()).strip("_")
    aliases = {
        "years": "year",
        "quarters": "quarter",
        "months": "month",
        "regions": "region",
        "groups": "consumption_group",
    }
    return aliases.get(value, value or "dimension")


ROMAN_NUMERALS = {
    numeral: number
    for number, numeral in enumerate(
        ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"], start=1
    )
}
MONTH_NAMES = {
    name: number
    for number, name in enumerate(
        ["january", "february", "march", "april", "may", "june", "july", "august",
         "september", "october", "november", "december"],
        start=1,
    )
}
ANNUAL_LABELS = {"annual", "total", "q i-iv", "i-iv"}
# National-accounts periods: "I 26*", "II  23", "2025*" (asterisk = preliminary).
ACCOUNTS_QUARTER = re.compile(r"^(I|II|III|IV)\s+(\d{2})(\*?)$")
ACCOUNTS_YEAR = re.compile(r"^(\d{4})(\*?)$")
PERIOD_COLUMNS = ["period_type", "period_start", "quarter_num", "month_num", "is_preliminary"]


def parse_period(row: dict[str, Any]) -> tuple[Any, ...]:
    """Return (year, period_type, quarter_num, month_num, is_preliminary) for one row."""
    if row.get("period") is not None:
        label = str(row["period"]).strip()
        if match := ACCOUNTS_QUARTER.match(label):
            return 2000 + int(match[2]), "quarter", ROMAN_NUMERALS[match[1]], None, bool(match[3])
        if match := ACCOUNTS_YEAR.match(label):
            return int(match[1]), "annual", None, None, bool(match[2])
        return None, None, None, None, False
    year = row.get("year")
    if year is None or pd.isna(year):
        return None, None, None, None, False
    if row.get("month") is not None:
        label = str(row["month"]).strip()
        month = (
            ROMAN_NUMERALS.get(label)
            or MONTH_NAMES.get(label.lower())
            or (int(label) if label.isdigit() and 1 <= int(label) <= 12 else None)
        )
        if month:
            return int(year), "month", (month + 2) // 3, month, False
        return int(year), ("annual" if label.lower() in ANNUAL_LABELS else None), None, None, False
    if row.get("quarter") is not None:
        label = re.sub(r"^Q\s*", "", str(row["quarter"]).strip())
        if label in ("1", "2", "3", "4"):
            return int(year), "quarter", int(label), None, False
        if label in ROMAN_NUMERALS and ROMAN_NUMERALS[label] <= 4:
            return int(year), "quarter", ROMAN_NUMERALS[label], None, False
        if label.lower() in ANNUAL_LABELS or str(row["quarter"]).strip().lower() in ANNUAL_LABELS:
            return int(year), "annual", None, None, False
        return int(year), None, None, None, False
    return int(year), "annual", None, None, False


def add_period_columns(frame: pd.DataFrame) -> pd.DataFrame:
    """Append uniform time columns so every table can be charted on one time axis."""
    time_columns = [c for c in ["period", "year", "quarter", "month"] if c in frame]
    if not time_columns:
        return frame
    keys = frame[time_columns].drop_duplicates()
    parsed = pd.DataFrame(
        [parse_period(row) for row in keys.to_dict("records")],
        columns=["_year", "period_type", "quarter_num", "month_num", "is_preliminary"],
        index=keys.index,
    )
    keys = pd.concat([keys, parsed], axis=1)
    result = frame.merge(keys, on=time_columns, how="left")
    if "year" not in result:
        result["year"] = result["_year"]
    result["year"] = pd.to_numeric(result["year"], errors="coerce").astype("Int64")
    result = result.drop(columns="_year")
    result["quarter_num"] = result["quarter_num"].astype("Int64")
    result["month_num"] = result["month_num"].astype("Int64")
    first_month = result["month_num"].fillna((result["quarter_num"] - 1) * 3 + 1).fillna(1)
    result["period_start"] = pd.to_datetime(
        {"year": result["year"], "month": first_month, "day": 1}, errors="coerce"
    ).dt.date
    result.loc[result["period_type"].isna(), "period_start"] = None
    result["is_preliminary"] = result["is_preliminary"].fillna(False).astype(bool)
    dimensions = [c for c in result.columns if c not in PERIOD_COLUMNS and c != "value"]
    return result[dimensions + ["value"] + PERIOD_COLUMNS]


def clean_label(value: Any) -> Any:
    """Trim and collapse internal whitespace (Geostat labels contain stray double spaces)."""
    if isinstance(value, pd.Series):
        return value.str.replace(r"\s+", " ", regex=True).str.strip()
    return re.sub(r"\s+", " ", value).strip()


def prepare_frame(
    frame: pd.DataFrame, dataset: str, renames: dict[str, str] | None = None
) -> pd.DataFrame:
    result = frame.rename(columns={column: sql_name(column) for column in frame.columns})
    result = result.rename(columns=renames or {})
    for column in result.columns:
        if pd.api.types.is_string_dtype(result[column]):
            result[column] = clean_label(result[column])
    # Collapsing whitespace can turn a label duplicated in the source into an exact
    # duplicate row (e.g. GDP at market prices on both sides of the use table).
    result = result.drop_duplicates(ignore_index=True)
    result.insert(0, "dataset", dataset)
    if "year" in result:
        result["year"] = pd.to_numeric(result["year"], errors="coerce").astype("Int64")
    result = add_period_columns(result)
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
    # Columns added after the first release; ALTER keeps older local databases usable.
    connection.execute("ALTER TABLE metadata.datasets ADD COLUMN IF NOT EXISTS topic VARCHAR")
    connection.execute("ALTER TABLE metadata.datasets ADD COLUMN IF NOT EXISTS title_ka VARCHAR")
    connection.execute("ALTER TABLE metadata.dimensions ADD COLUMN IF NOT EXISTS language VARCHAR")


def resolve_path(definition: dict[str, Any], client: GeostatClient) -> str:
    """Use the fixed path, or find the table in `folder` whose id matches `match`.

    Some Geostat tables are renamed every release (e.g. "..._(Quarter_II,_2026).px").
    """
    if "path" in definition:
        return definition["path"]
    pattern = re.compile(definition["match"])
    matches = sorted(
        item["id"] for item in client.catalog(definition["folder"])
        if item.get("type") == "t" and pattern.search(item["id"])
    )
    if len(matches) != 1:
        raise LookupError(f"Expected one table matching {pattern.pattern!r}, found {matches}")
    return f"{definition['folder']}/{matches[0]}"


SOURCE_NAME = "National Statistics Office of Georgia (Geostat)"


def fetch_dataset(
    definition: dict[str, Any], language: str = "en"
) -> tuple[pd.DataFrame, dict[str, Any], list[list[Any]]]:
    """Download one registered dataset from its source.

    Returns the raw frame, provenance for `metadata.datasets`, and label rows
    (source_code, column, label, value_id, value_label, language) for `metadata.dimensions`.
    """
    source = definition.get("source", "pxweb")
    retrieved_at = datetime.now(UTC).isoformat()
    if source == "pxweb":
        client = GeostatClient(language=language)
        path = resolve_path(definition, client)
        metadata = client.metadata(path)
        # Georgian labels share value IDs and dimension order with the English metadata.
        metadata_ka = GeostatClient(language="ka").metadata(path)
        frame, provenance = client.fetch(path)
        renames = definition.get("rename", {})
        labels: list[list[Any]] = []
        for variable, variable_ka in zip(metadata["variables"], metadata_ka["variables"]):
            column = sql_name(variable["code"])
            column = renames.get(column, column)
            for meta, lang in [(variable, "en"), (variable_ka, "ka")]:
                for value_id, value_label in zip(meta["values"], meta["valueTexts"]):
                    labels.append(
                        [variable["code"], column, meta["text"], value_id, clean_label(value_label), lang]
                    )
        info = {
            "title": metadata.get("title"),
            "title_ka": metadata_ka.get("title"),
            "source_url": provenance["source_url"],
            "source_path": path,
            "retrieved_at": provenance["retrieved_at"],
        }
        return frame, info, labels

    if source == "prices_api":
        result = prices_api.fetch(definition["resource"])
    elif source == "gis_api":
        result = gis_api.fetch(definition["level"])
    else:
        raise ValueError(f"Unknown source {source!r}")
    labels = []
    # Adapters may emit the same label once per row (e.g. a product group); keep one each.
    for column, value_id, english, georgian in dict.fromkeys(result.labels):
        labels.append([column, column, column, value_id, clean_label(english), "en"])
        labels.append([column, column, column, value_id, clean_label(georgian), "ka"])
    title = definition.get("title", {})
    info = {
        "title": localized(definition, "title"),
        "title_ka": title.get("ka") if isinstance(title, dict) else None,
        "source_url": result.source_url,
        "source_path": result.source_path,
        "retrieved_at": retrieved_at,
    }
    return result.frame, info, labels


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
    frame, info, labels = fetch_dataset(definition, language)
    frame = prepare_frame(frame, dataset, definition.get("rename"))

    database.parent.mkdir(parents=True, exist_ok=True)
    with duckdb.connect(str(database)) as connection:
        initialize(connection)
        connection.register("incoming_frame", frame)
        connection.execute(f"CREATE OR REPLACE TABLE {definition['table']} AS SELECT * FROM incoming_frame")
        connection.execute("DELETE FROM metadata.datasets WHERE dataset = ?", [dataset])
        connection.execute(
            """
            INSERT INTO metadata.datasets (
                dataset, table_name, title, description, grain, unit, source, source_url,
                source_path, source_language, retrieved_at, row_count, topic, title_ka
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                dataset,
                definition["table"],
                info["title"],
                localized(definition, "description"),
                definition["grain"],
                localized(definition, "unit"),
                SOURCE_NAME,
                info["source_url"],
                info["source_path"],
                language,
                info["retrieved_at"],
                len(frame),
                definition.get("topic"),
                info["title_ka"],
            ],
        )
        connection.execute("DELETE FROM metadata.dimensions WHERE dataset = ?", [dataset])
        connection.executemany(
            "INSERT INTO metadata.dimensions (dataset, source_code, column_name, label, value_id, "
            "value_label, language) VALUES (?, ?, ?, ?, ?, ?, ?)",
            [[dataset, *row] for row in labels],
        )
        refresh_views(connection)
    return len(frame)


def dataset_age_days(dataset: str, database: Path = DEFAULT_DATABASE) -> float | None:
    """Days since the dataset was last synced, or None if it never was."""
    if not database.exists():
        return None
    with duckdb.connect(str(database), read_only=True) as connection:
        try:
            row = connection.execute(
                "SELECT retrieved_at FROM metadata.datasets WHERE dataset = ?", [dataset]
            ).fetchone()
        except duckdb.CatalogException:
            return None
    if not row or row[0] is None:
        return None
    return (datetime.now(UTC) - row[0]).total_seconds() / 86400


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
