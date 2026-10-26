# AI context: Geostat analytical database

## Purpose

`data/geostat.duckdb` is a local analytical database sourced from the official Geostat
PXWeb API. Use SQL for inspection and analysis. Never assume a dataset has been synced:
check `metadata.datasets` first. The same tables and views are published as Parquet in
`web/public/data/` (described by `catalog.json`) and are queryable in the web SQL console.

## Metadata contract

- `metadata.datasets`: one row per loaded dataset, including table name, description,
  row grain, unit, exact API URL, source path, retrieval timestamp, and row count.
- `metadata.dimensions`: source dimension codes, normalized SQL column names, value IDs,
  and labels in English (`language = 'en'`) and Georgian (`'ka'`). Data columns hold the
  English labels.
- `DESCRIBE <table>`: authoritative physical columns and types.

All fact tables are tidy/long: dimension columns identify an observation and `value` is
the published numeric measure. Missing values remain SQL `NULL` (tables are dense grids, so
future periods exist as NULL rows). Labels are trimmed with internal whitespace collapsed.

Every table also carries uniform time columns, derived from whatever time encoding the
source uses (Roman-numeral months, `Q I-IV`, `I 26*`, …):

- `period_type`: `month`, `quarter`, or `annual`. Never mix types in one series.
- `period_start`: first day of the period (annual = 1 January). Sort and join on this.
- `quarter_num` (1–4), `month_num` (1–12): NULL when not applicable.
- `is_preliminary`: national-accounts periods Geostat flags with `*` (subject to revision).

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

### Other registered tables

| Table | Dimensions | Unit / notes |
|---|---|---|
| `salaries_regional` | `region`, year, `quarter` | GEL/month; `Total` = country; `Annual` rows compiled separately |
| `labour_force_quarterly` | `sex_urban_rural_areas`, `economic_status`, year, `quarter` | as `employment_regional`; source table is renamed each quarter, sync resolves it |
| `property_prices_quarterly` | `dwelling_type`, year, `quarter` | index, 2020 average = 100 |
| `gdp_current_prices` | `activity`, `period` | million GEL; also per-capita rows (GEL, USD), `GDP in mil. USD`, and the average GEL per USD rate — not additive with sections |
| `gdp_real_growth` | `activity`, `period` | index, same period of previous year = 100 (growth % = value − 100); includes `GDP deflator` |
| `gdp_by_use` | `indicator`, `period` | million GEL; consumption, capital formation, exports/imports of goods and services; header rows are NULL |
| `fdi_quarterly` | `sources`, year, `quarter` | **USD** (not millions); `Q I-IV` = annual |
| `population_regional` | `area`, year | thousand persons on 1 January; mixes country/regions/municipalities and footnote rows |
| `population_age_sex` | `age`, year, `sex` | thousand persons; `Total` / `Both Sexes` are aggregates |
| `poverty_absolute` | `population_group`, year | percent below the absolute poverty line; groups overlap (area, age, sex) |

### Prices portal tables (source `prices_api`, https://prices-api.geostat.ge)

| Table | Dimensions | Unit / notes |
|---|---|---|
| `retail_prices_monthly` | `product`, `product_group`, `unit_of_measure`, year, `month` | average shop price, GEL per `unit_of_measure` (101 products, 2020+) |
| `inflation_measures_monthly` | `measure`, year, `month` | % YoY: headline CPI, core, HICP, durable / semi-durable / non-durable goods, services |
| `inflation_components_monthly` | `component`, year, `month` | index, December 2020 = 100 (food, energy, non-energy goods, services) |
| `cpi_basket_weights_annual` | `classification`, `item`, year | % of the CPI basket; each classification sums to 100 per year |
| `producer_prices_monthly` | `series`, year, `month` | index, 2020 average = 100 (PPI, export, import, services PPI) |
| `construction_costs_monthly` | `component`, year, `month` | index, February 2022 = 100 |
| `agro_prices_quarterly` | `measure`, year, `quarter` | % change of the agricultural unit value index |
| `tbilisi_property_quarterly` | `district`, `dwelling_type`, year, `quarter` | median GEL per m², 10 Tbilisi districts, 2021+ |

The headline CPI here equals PXWeb `inflation_monthly` (PXWeb rounds older months to 0.1).

### GeoMap tables (source `gis_api`, https://gis-api.geostat.ge — data end in 2022)

`business_regional_annual` (`indicator`, `region`, `region_code`, year) and
`business_municipal_annual` (`indicator`, `municipality`, `municipality_code`, `region_code`,
year). The unit is part of each `indicator` label (million GEL, GEL per month, or persons).
Figures equal PXWeb Business Statistics. The municipal table omits Tbilisi's values — use the
`business_by_area` view. Codes match the map files in `web/public/data/geo/`.

External trade tables on the PXWeb API stop in 2020, so they are not registered. Use
exports/imports of goods and services from `gdp_by_use` / `gdp_headline` instead.

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

### Other views

- `inflation_monthly`: national CPI level, month-over-month and year-over-year inflation (%).
- `gdp_headline`: one row per national-accounts period — GDP (million GEL/USD), per capita,
  `gel_per_usd`, `real_growth_pct`, `deflator_pct`, consumption, capital formation,
  exports/imports (goods, services) and `net_exports_mln_gel`.
- `gdp_by_activity`: GVA by NACE section with `share_of_gva_pct` and `real_growth_pct`.
- `labour_quarterly` / `labour_regional_annual`: LFS indicators pivoted to columns
  (`unemployment_rate_pct`, `participation_rate_pct`, `employment_rate_pct`, levels in
  thousands with `_k` suffix) by population group or region.
- `population_by_area`: population with `area_level` (`country`/`region`/`municipality`)
  and parent `region`; regions sum to the country, municipalities to their region.

- `retail_prices_latest`: one row per product with latest price, YoY %, change since Jan 2020,
  12-month low/high.
- `inflation_breakdown_monthly`: YoY % for every inflation measure and CPI component
  (`measure_type` = `measure` or `component`; "Services" exists in both and agrees).
- `tbilisi_property_latest`: latest quarter by district and dwelling type with YoY change.
- `business_by_area`: regions and municipalities (`area_level`) with Tbilisi filled in for
  municipalities, plus turnover and value added per person employed (thousand GEL).

## Analysis rules

1. Read `metadata.datasets`, the table schema, and relevant dimension labels first.
2. State filters, period, units, and whether values are levels, indices, or rates.
3. Prefer published country totals rather than manually summing regional figures.
4. Do not mix annual salary rows with quarterly rows in one time-series calculation.
5. Cite Geostat and include the dataset's `retrieved_at` date in analytical outputs.
6. Treat the latest year as potentially incomplete, especially quarterly/monthly data.
7. For "real" or "inflation-adjusted" wage questions, use `real_wages_quarterly` rather
   than dividing by the YoY inflation table yourself.
