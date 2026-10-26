# Geostat local analytical database

This project builds a small, local [DuckDB](https://duckdb.org/) database from the
[National Statistics Office of Georgia (Geostat)](https://www.geostat.ge/) PXWeb API.
It registers 24 tables from three Geostat sources — the PXWeb statistical database, the price
statistics portal API (shop prices, inflation breakdown, producer and construction prices,
Tbilisi housing) and the GeoMap API (business statistics by region and municipality) — plus
derived views such as inflation-adjusted wages, and publishes them as static files for the
**Georgia in Numbers** web app (`web/`). Each entry in `datasets.json` names its `source`.

No dataset is downloaded automatically. You choose exactly what to sync.

## Setup

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -e .
```

## Build or update the database

```bash
# One subject only
geostat sync salaries

# Any combination
geostat sync employment inflation

# All registered subjects
geostat sync all
```

The result is `data/geostat.duckdb`. Re-running a sync atomically replaces only that
dataset's table and refreshes its metadata.

GeoMap datasets refresh at most every 30 days (`max_age_days`) and a failure there keeps the
previous table instead of stopping the refresh. `geostat sync all --force` ignores the age limit.

## Map boundaries

```bash
geostat boundaries   # Geostat GeoServer -> simplified GeoJSON in web/public/data/geo/
```

Run it only when boundaries change; the output is committed.

## Publish for the web app

```bash
geostat check    # data-quality gates vs the last export (row drops, stale periods, identities)
geostat check --cross-source   # also compare GeoMap figures with PXWeb (network)
geostat export   # Parquet + catalog.json + dashboards/*.json -> web/public/data/
```

Labels for the three UI languages come from Geostat (English, Georgian) and from
`i18n/labels_ru.json`, `i18n/labels_ka.json` (overrides) and `i18n/columns.json`.

## Query with SQL

Start the DuckDB shell, or connect from any Python program:

```python
import duckdb

con = duckdb.connect("data/geostat.duckdb", read_only=True)
print(con.sql("SELECT * FROM metadata.datasets").df())
print(con.sql("""
    SELECT year, quarter, value AS salary_gel
    FROM salaries_quarterly
    WHERE sex_sectors = 'Total in country'
      AND economic_activity = 'Total'
    ORDER BY year, quarter
""").df())
```

For inflation, the stored `value` is an index where the same month a year earlier equals
100. The derived `inflation_rate` column is the familiar percentage rate (`value - 100`).

### Real wages

Once `salaries` and `cpi` are synced, the `real_wages_quarterly` view deflates salaries by
the national CPI and adds a real wage index (2014 = 100) and year-over-year changes:

```sql
SELECT period_start, nominal_salary_gel, real_salary_gel_2010,
       real_wage_index_2014, nominal_yoy_pct, cpi_yoy_pct, real_yoy_pct
FROM real_wages_quarterly
WHERE sex_sectors = 'Total in country'
  AND economic_activity = 'Total'
  AND period_type = 'quarter'
ORDER BY period_start;
```

Keep `period_type = 'quarter'` and `'annual'` apart: Geostat's annual figure is compiled
differently and sits 3–5% below the mean of the quarters.

## Give the database to an AI/LLM

Point the model at:

- `data/geostat.duckdb` — data and machine-readable metadata;
- `AI_CONTEXT.md` — stable schema guidance and interpretation rules;
- `datasets.json` — registered source tables and their meanings.

Run `geostat describe-db` for a concise, current inventory. Inside DuckDB, these tables
provide provenance and dimension dictionaries:

```sql
SELECT * FROM metadata.datasets;
SELECT * FROM metadata.dimensions WHERE dataset = 'employment';
DESCRIBE employment_regional;
```

## Add another subject later

Add one entry to `datasets.json` with a unique SQL table name, PXWeb path, description,
grain, and unit. Then run `geostat sync <new-name>`. The importer and metadata catalog do
not need to be rewritten.

## Attribution

Source: National Statistics Office of Georgia (Geostat). Geostat permits reuse and
adaptation of its published statistical data with source attribution. Its permission does
not extend to third-party material, logos, or trademarks.
