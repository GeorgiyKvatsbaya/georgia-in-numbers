# AI context: Geostat analytical database

## Purpose

`data/geostat.duckdb` is a local analytical database sourced from the official Geostat
PXWeb API. Use SQL for inspection and analysis. Never assume a dataset has been synced:
check `metadata.datasets` first.

## Metadata contract

- `metadata.datasets`: one row per loaded dataset, including table name, description,
  row grain, unit, exact API URL, source path, retrieval timestamp, and row count.
- `metadata.dimensions`: source dimension codes, normalized SQL column names, value IDs,
  and human-readable labels.
- `DESCRIBE <table>`: authoritative physical columns and types.

All fact tables are tidy/long: dimension columns identify an observation and `value` is
the published numeric measure. Missing values remain SQL `NULL`.

## Registered fact tables

### `salaries_quarterly`

Average monthly nominal salary of employees. Dimensions are `sex_sectors`,
`economic_activity`, `year`, and `quarter`. Unit is GEL/month. `quarter` includes I–IV
and `annual`; do not average those five values together. These are nominal, not
inflation-adjusted, salaries.

### `employment_regional`

Labour force statistics by `economic_status`, `year`, and `region`. Units depend on
`economic_status`: level indicators are thousands of persons; indicators whose label ends
in “rate, percentage” are percentages. Do not sum regions together with the `Georgia`
aggregate or with overlapping aggregate regions.

### `inflation_yoy_monthly`

Year-over-year CPI by `region`, `consumption_group`, `year`, and `month`. `value` is an index with the
same month of the prior year equal to 100. `inflation_rate = value - 100` is the annual
percentage inflation rate. Roman-numeral months I–XII correspond to January–December.

### `cpi_index_monthly`

CPI price level by `region`, `year`, and `month`, with the 2010 average = 100. Use this
(not the YoY table) to deflate nominal values or to compare price levels across
non-adjacent periods. Months are Roman numerals stored as text, so sort them explicitly.

## Derived views

Views are rebuilt by every `geostat sync` once their source tables exist. `COMMENT` on
each view (see `duckdb_views()`) carries its definition.

### `real_wages_quarterly`

Built from `salaries_quarterly` and the national (`Georgia`) rows of `cpi_index_monthly`.
Same grain as `salaries_quarterly`. Columns:

- `period_type` is `quarter` or `annual`. `quarter_num` (1–4, NULL for annual) and
  `period_start` give correct chronological ordering.
- `nominal_salary_gel`: published GEL/month.
- `cpi_2010_100`: mean monthly CPI over the period; NULL unless every month is published.
- `real_salary_gel_2010`: nominal ÷ (CPI/100), i.e. GEL/month at 2010 prices.
- `real_wage_index_2014`: 100 = 2014 mean real salary of the same series and `period_type`.
- `nominal_yoy_pct`, `cpi_yoy_pct`, `real_yoy_pct`: percent change versus the same quarter
  (or year) one year earlier. (1 + nominal) = (1 + real) × (1 + CPI).

Geostat's annual salary figure is consistently 3–5% below the mean of its four quarters
(different compilation method). Filter on one `period_type`; never mix them in a series.
The `Public sector` / `Non-public sector` breakdowns by activity exist only as annual rows.

## Analysis rules

1. Read `metadata.datasets`, the table schema, and relevant dimension labels first.
2. State filters, period, units, and whether values are levels, indices, or rates.
3. Prefer published country totals rather than manually summing regional figures.
4. Do not mix annual salary rows with quarterly rows in one time-series calculation.
5. Cite Geostat and include the dataset's `retrieved_at` date in analytical outputs.
6. Treat the latest year as potentially incomplete, especially quarterly/monthly data.
7. For "real" or "inflation-adjusted" wage questions, use `real_wages_quarterly` rather
   than dividing by the YoY inflation table yourself.
