"""Derived DuckDB views. Business logic shared by the CLI, exports and the web app."""

from __future__ import annotations

from typing import Any

import duckdb

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
    "inflation_monthly": {
        "requires": ["inflation_yoy_monthly", "cpi_index_monthly"],
        "description": (
            "Headline national CPI by month: the 2010=100 level, month-over-month change, and "
            "Geostat's published year-over-year inflation (all items, Georgia)."
        ),
        "sql": """
            WITH levels AS (
                SELECT
                    year,
                    month_num,
                    period_start,
                    value AS cpi_2010_100,
                    lag(value) OVER (ORDER BY period_start) AS prior_value,
                    lag(period_start) OVER (ORDER BY period_start) AS prior_start
                FROM cpi_index_monthly
                WHERE region = 'Georgia' AND value IS NOT NULL
            ),
            headline AS (
                SELECT period_start, value - 100 AS inflation_yoy_pct
                FROM inflation_yoy_monthly
                WHERE region = 'Georgia' AND consumption_group = 'Total' AND value IS NOT NULL
            )
            SELECT
                l.year,
                l.month_num,
                l.period_start,
                round(l.cpi_2010_100, 4) AS cpi_2010_100,
                CASE WHEN date_diff('month', l.prior_start, l.period_start) = 1
                    THEN round(100 * (l.cpi_2010_100 / l.prior_value - 1), 4)
                END AS inflation_mom_pct,
                round(h.inflation_yoy_pct, 4) AS inflation_yoy_pct
            FROM levels AS l
            LEFT JOIN headline AS h USING (period_start)
        """,
    },
    "gdp_headline": {
        "requires": ["gdp_current_prices", "gdp_real_growth", "gdp_by_use"],
        "description": (
            "One row per national-accounts period (quarter or year): nominal GDP (million GEL "
            "and USD), GDP per capita, average GEL per USD, real GDP growth and deflator "
            "(percent vs the same period a year earlier), and expenditure components including "
            "exports and imports of goods and services (million GEL). Keep period_type apart; "
            "is_preliminary marks figures Geostat may revise."
        ),
        "sql": """
            WITH nominal AS (
                SELECT
                    year, period_type, quarter_num, period_start, is_preliminary,
                    max(value) FILTER (WHERE activity = '(=) GDP at market prices') AS gdp_mln_gel,
                    max(value) FILTER (WHERE activity = 'GDP in mil. USD') AS gdp_mln_usd,
                    max(value) FILTER (WHERE activity = 'GDP per capita in GEL') AS gdp_per_capita_gel,
                    max(value) FILTER (WHERE activity = 'GDP per capita, USD') AS gdp_per_capita_usd,
                    max(value) FILTER (WHERE activity LIKE 'Exchange rate, USD/GEL%') AS gel_per_usd
                FROM gdp_current_prices
                GROUP BY year, period_type, quarter_num, period_start, is_preliminary
            ),
            growth AS (
                SELECT
                    period_type, period_start,
                    max(value) FILTER (WHERE activity = '(=) GDP at market prices') - 100
                        AS real_growth_pct,
                    max(value) FILTER (WHERE activity = 'GDP deflator') - 100 AS deflator_pct
                FROM gdp_real_growth
                GROUP BY period_type, period_start
            ),
            uses AS (
                SELECT
                    period_type, period_start,
                    max(value) FILTER (WHERE indicator = 'P.3 Final Consumption Expenditures')
                        AS final_consumption_mln_gel,
                    max(value) FILTER (WHERE indicator = 'P.5 (+) Gross Capital Formation')
                        AS gross_capital_formation_mln_gel,
                    max(value) FILTER (WHERE indicator = 'P.6 (+) Exports of Goods and Services')
                        AS exports_mln_gel,
                    max(value) FILTER (WHERE indicator = 'P.61 Exports of goods') AS exports_goods_mln_gel,
                    max(value) FILTER (WHERE indicator = 'P.62 Exports of Services')
                        AS exports_services_mln_gel,
                    max(value) FILTER (WHERE indicator = 'P.7 (-) Imports of Goods and Services')
                        AS imports_mln_gel,
                    max(value) FILTER (WHERE indicator = 'P.71 Imports of Goods') AS imports_goods_mln_gel,
                    max(value) FILTER (WHERE indicator = 'P.72 Imports of Services')
                        AS imports_services_mln_gel
                FROM gdp_by_use
                GROUP BY period_type, period_start
            )
            SELECT
                n.year,
                n.period_type,
                n.quarter_num,
                n.period_start,
                n.is_preliminary,
                round(n.gdp_mln_gel, 2) AS gdp_mln_gel,
                round(n.gdp_mln_usd, 2) AS gdp_mln_usd,
                round(n.gdp_per_capita_gel, 2) AS gdp_per_capita_gel,
                round(n.gdp_per_capita_usd, 2) AS gdp_per_capita_usd,
                round(n.gel_per_usd, 4) AS gel_per_usd,
                round(g.real_growth_pct, 4) AS real_growth_pct,
                round(g.deflator_pct, 4) AS deflator_pct,
                round(u.final_consumption_mln_gel, 2) AS final_consumption_mln_gel,
                round(u.gross_capital_formation_mln_gel, 2) AS gross_capital_formation_mln_gel,
                round(u.exports_mln_gel, 2) AS exports_mln_gel,
                round(u.exports_goods_mln_gel, 2) AS exports_goods_mln_gel,
                round(u.exports_services_mln_gel, 2) AS exports_services_mln_gel,
                round(u.imports_mln_gel, 2) AS imports_mln_gel,
                round(u.imports_goods_mln_gel, 2) AS imports_goods_mln_gel,
                round(u.imports_services_mln_gel, 2) AS imports_services_mln_gel,
                round(u.exports_mln_gel - u.imports_mln_gel, 2) AS net_exports_mln_gel
            FROM nominal AS n
            LEFT JOIN growth AS g USING (period_type, period_start)
            LEFT JOIN uses AS u USING (period_type, period_start)
            WHERE n.gdp_mln_gel IS NOT NULL
        """,
    },
    "gdp_by_activity": {
        "requires": ["gdp_current_prices", "gdp_real_growth"],
        "description": (
            "Gross value added by NACE Rev. 2 section (A-T) per national-accounts period: value "
            "at current prices (million GEL), share of total GVA across sections, and real "
            "growth (percent vs the same period a year earlier)."
        ),
        "sql": """
            WITH sections AS (
                SELECT
                    regexp_extract(activity, '^([A-T]) ', 1) AS nace_section,
                    regexp_replace(activity, '^[A-T] ', '') AS activity,
                    activity AS source_activity,
                    year, period_type, quarter_num, period_start, is_preliminary,
                    value AS gva_mln_gel
                FROM gdp_current_prices
                WHERE regexp_matches(activity, '^[A-T] ') AND value IS NOT NULL
            )
            SELECT
                s.nace_section,
                s.activity,
                s.year,
                s.period_type,
                s.quarter_num,
                s.period_start,
                s.is_preliminary,
                round(s.gva_mln_gel, 2) AS gva_mln_gel,
                round(100 * s.gva_mln_gel
                    / sum(s.gva_mln_gel) OVER (PARTITION BY s.period_type, s.period_start), 4)
                    AS share_of_gva_pct,
                round(g.value - 100, 4) AS real_growth_pct
            FROM sections AS s
            LEFT JOIN gdp_real_growth AS g
                ON g.activity = s.source_activity
                AND g.period_type = s.period_type
                AND g.period_start = s.period_start
        """,
    },
    "labour_quarterly": {
        "requires": ["labour_force_quarterly"],
        "description": (
            "Quarterly (and annual) Labour Force Survey headline indicators, one row per "
            "population group (Total, Female, Male, Urban, Rural) and period: unemployment, "
            "participation and employment rates (percent) and levels (thousand persons)."
        ),
        "sql": """
            SELECT
                sex_urban_rural_areas AS population_group,
                year, period_type, quarter_num, period_start,
                {labour_columns}
            FROM labour_force_quarterly
            GROUP BY ALL
            HAVING count(value) > 0
        """,
    },
    "labour_regional_annual": {
        "requires": ["employment_regional"],
        "description": (
            "Annual Labour Force Survey headline indicators by region: unemployment, "
            "participation and employment rates (percent) and levels (thousand persons). "
            "'Georgia' is the national figure; do not add regions to it."
        ),
        "sql": """
            SELECT
                region,
                year, period_type, period_start,
                {labour_columns}
            FROM employment_regional
            GROUP BY ALL
            HAVING count(value) > 0
        """,
    },
    "population_by_area": {
        "requires": ["population_regional"],
        "description": (
            "Population on 1 January (thousand persons) by area with its level: 'country', "
            "'region' (incl. Tbilisi and the autonomous republics), or 'municipality' with its "
            "parent region. Sum only within one level. Municipalities marked * or ** are "
            "included in another unit for some years (see Geostat notes)."
        ),
        "sql": """
            WITH ordered AS (
                SELECT value_label AS area, try_cast(value_id AS INTEGER) AS position
                FROM metadata.dimensions
                WHERE dataset = 'population' AND column_name = 'area' AND language = 'en'
            ),
            classified AS (
                SELECT
                    area,
                    position,
                    CASE
                        WHEN area = 'Georgia' THEN 'country'
                        WHEN area LIKE '*%' OR area LIKE '-%' THEN 'note'
                        WHEN area LIKE '% Region' OR area LIKE '% A.R.'
                            OR area = 'C. Tbilisi Municipality' THEN 'region'
                        ELSE 'municipality'
                    END AS area_level
                FROM ordered
            ),
            with_parent AS (
                SELECT
                    *,
                    last_value(CASE WHEN area_level = 'region' THEN area END IGNORE NULLS)
                        OVER (ORDER BY position ROWS UNBOUNDED PRECEDING) AS region
                FROM classified
            )
            SELECT
                p.area,
                w.area_level,
                CASE WHEN w.area_level IN ('region', 'municipality') THEN w.region END AS region,
                w.position AS source_order,
                p.year,
                p.period_start,
                p.value AS population_k
            FROM population_regional AS p
            JOIN with_parent AS w USING (area)
            WHERE w.area_level <> 'note' AND p.value IS NOT NULL
        """,
    },
    "retail_prices_latest": {
        "requires": ["retail_prices_monthly"],
        "description": (
            "One row per product: latest average shop price (GEL per unit_of_measure), the "
            "price a year earlier and in January 2020, percent changes, and the 12-month low "
            "and high. Source: Geostat price statistics portal."
        ),
        "sql": """
            WITH latest AS (
                SELECT product, max(period_start) AS period_start
                FROM retail_prices_monthly WHERE value IS NOT NULL GROUP BY product
            )
            SELECT
                p.product,
                p.product_group,
                p.unit_of_measure,
                l.period_start,
                round(p.value, 4) AS price_gel,
                round(y.value, 4) AS price_year_ago_gel,
                round(100 * (p.value / y.value - 1), 2) AS change_yoy_pct,
                round(100 * (p.value / b.value - 1), 2) AS change_since_2020_pct,
                round(w.low, 4) AS low_12m_gel,
                round(w.high, 4) AS high_12m_gel
            FROM latest AS l
            JOIN retail_prices_monthly AS p USING (product, period_start)
            LEFT JOIN retail_prices_monthly AS y
                ON y.product = l.product AND y.period_start = l.period_start - INTERVAL 1 YEAR
            LEFT JOIN retail_prices_monthly AS b
                ON b.product = l.product AND b.period_start = DATE '2020-01-01'
            LEFT JOIN (
                SELECT r.product, min(r.value) AS low, max(r.value) AS high
                FROM retail_prices_monthly AS r JOIN latest AS x USING (product)
                WHERE r.period_start > x.period_start - INTERVAL 12 MONTH
                GROUP BY r.product
            ) AS w ON w.product = l.product
        """,
    },
    "inflation_breakdown_monthly": {
        "requires": ["inflation_measures_monthly", "inflation_components_monthly"],
        "description": (
            "Year-over-year inflation (%) by measure in one place: headline, core and HICP, "
            "durability classes, and the CPI components food, energy, non-energy goods and "
            "services (computed from their Dec 2020 = 100 indices)."
        ),
        "sql": """
            SELECT measure, 'measure' AS measure_type, year, month_num, period_start,
                   round(value, 4) AS inflation_yoy_pct
            FROM inflation_measures_monthly
            WHERE value IS NOT NULL
            UNION ALL
            SELECT c.component, 'component', c.year, c.month_num, c.period_start,
                   round(100 * (c.value / p.value - 1), 4)
            FROM inflation_components_monthly AS c
            JOIN inflation_components_monthly AS p
                ON p.component = c.component
                AND p.period_start = c.period_start - INTERVAL 1 YEAR
            WHERE c.value IS NOT NULL AND p.value IS NOT NULL
        """,
    },
    "tbilisi_property_latest": {
        "requires": ["tbilisi_property_quarterly"],
        "description": (
            "Latest quarter of median residential property prices per m² (GEL) by Tbilisi "
            "district and dwelling type, with the change versus the same quarter a year earlier."
        ),
        "sql": """
            WITH latest AS (
                SELECT dwelling_type, max(period_start) AS period_start
                FROM tbilisi_property_quarterly WHERE value IS NOT NULL GROUP BY dwelling_type
            )
            SELECT
                t.district,
                t.dwelling_type,
                t.year,
                t.quarter_num,
                t.period_start,
                t.value AS median_price_gel_m2,
                y.value AS year_ago_gel_m2,
                round(100 * (t.value / y.value - 1), 2) AS change_yoy_pct
            FROM tbilisi_property_quarterly AS t
            JOIN latest USING (dwelling_type, period_start)
            LEFT JOIN tbilisi_property_quarterly AS y
                ON y.district = t.district AND y.dwelling_type = t.dwelling_type
                AND y.period_start = t.period_start - INTERVAL 1 YEAR
        """,
    },
    "business_by_area": {
        "requires": ["business_regional_annual", "business_municipal_annual"],
        "description": (
            "Business statistics for regions and municipalities in one long table. "
            "area_code matches the map files (web/public/data/geo). The municipal source omits "
            "Tbilisi's values, so Tbilisi's municipal rows come from the regional table. Adds "
            "turnover and value added per person employed (thousand GEL). Latest year: 2022."
        ),
        "sql": """
            WITH combined AS (
                SELECT 'region' AS area_level, region AS area, region_code AS area_code,
                       region_code, indicator, year, period_start, value
                FROM business_regional_annual
                UNION ALL
                SELECT 'municipality', municipality, municipality_code, region_code, indicator,
                       year, period_start, value
                FROM business_municipal_annual
                WHERE municipality_code <> '11'
                UNION ALL
                SELECT 'municipality', 'C. Tbilisi', '11', '11', indicator, year,
                       period_start, value
                FROM business_regional_annual
                WHERE region_code = '11'
            ),
            ratios AS (
                SELECT
                    area_level, area, area_code, region_code, year, period_start,
                    max(value) FILTER (WHERE indicator = 'Turnover, million GEL') AS turnover,
                    max(value) FILTER (WHERE indicator = 'Value added, million GEL') AS value_added,
                    max(value) FILTER (WHERE indicator = 'Persons employed') AS employed
                FROM combined
                GROUP BY ALL
            )
            SELECT * FROM combined WHERE value IS NOT NULL
            UNION ALL
            SELECT area_level, area, area_code, region_code,
                   'Turnover per person employed, thousand GEL', year, period_start,
                   round(1000 * turnover / employed, 2)
            FROM ratios WHERE employed > 0 AND turnover IS NOT NULL
            UNION ALL
            SELECT area_level, area, area_code, region_code,
                   'Value added per person employed, thousand GEL', year, period_start,
                   round(1000 * value_added / employed, 2)
            FROM ratios WHERE employed > 0 AND value_added IS NOT NULL
        """,
    },
}

# Shared pivot of Labour Force Survey "economic status" rows into columns.
LABOUR_COLUMNS = ",\n                ".join(
    f"max(value) FILTER (WHERE economic_status = '{status}') AS {column}"
    for status, column in [
        ("Unemployment rate, percentage", "unemployment_rate_pct"),
        ("Labour force participation rate, percentage", "participation_rate_pct"),
        ("Employment rate, percentage", "employment_rate_pct"),
        ("Total 15 + population", "population_15plus_k"),
        ("Labour force, total", "labour_force_k"),
        ("Employed", "employed_k"),
        ("Hired", "hired_k"),
        ("Self-employed", "self_employed_k"),
        ("Unemployed", "unemployed_k"),
        ("Population outside labor force", "outside_labour_force_k"),
    ]
)
for _name in ["labour_quarterly", "labour_regional_annual"]:
    DERIVED_VIEWS[_name]["sql"] = DERIVED_VIEWS[_name]["sql"].replace(
        "{labour_columns}", LABOUR_COLUMNS
    )


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


# Presentation metadata for the web catalog (titles and summaries in every UI language).
VIEW_META: dict[str, dict[str, Any]] = {
    "real_wages_quarterly": {
        "topic": "wages",
        "title": {
            "en": "Real wages (inflation-adjusted)",
            "ka": "რეალური ხელფასი (ინფლაციის გათვალისწინებით)",
            "ru": "Реальная зарплата (с учётом инфляции)",
        },
        "summary": {
            "en": "Average salary deflated by the national CPI, with a real wage index (2014 = 100) and year-over-year changes.",
            "ka": "საშუალო ხელფასი სამომხმარებლო ფასების ინდექსით დეფლირებული, რეალური ხელფასის ინდექსით (2014 = 100) და წლიური ცვლილებებით.",
            "ru": "Средняя зарплата, скорректированная на ИПЦ, с индексом реальной зарплаты (2014 = 100) и годовыми изменениями.",
        },
    },
    "inflation_monthly": {
        "topic": "prices",
        "title": {"en": "Headline inflation", "ka": "ძირითადი ინფლაცია", "ru": "Общая инфляция"},
        "summary": {
            "en": "National CPI level, monthly and annual inflation for all items.",
            "ka": "სამომხმარებლო ფასების ინდექსი, თვიური და წლიური ინფლაცია.",
            "ru": "Уровень ИПЦ по стране, месячная и годовая инфляция по всем товарам и услугам.",
        },
    },
    "gdp_headline": {
        "topic": "economy",
        "title": {"en": "GDP headline indicators", "ka": "მშპ-ის ძირითადი მაჩვენებლები", "ru": "Основные показатели ВВП"},
        "summary": {
            "en": "Nominal GDP, per capita, exchange rate, real growth, deflator, and expenditure components incl. exports and imports.",
            "ka": "ნომინალური მშპ, მშპ ერთ სულზე, გაცვლითი კურსი, რეალური ზრდა, დეფლატორი, ექსპორტი და იმპორტი.",
            "ru": "Номинальный ВВП, ВВП на душу, курс, реальный рост, дефлятор и компоненты использования, включая экспорт и импорт.",
        },
    },
    "gdp_by_activity": {
        "topic": "economy",
        "title": {"en": "GDP by economic activity", "ka": "მშპ ეკონომიკური საქმიანობის მიხედვით", "ru": "ВВП по видам деятельности"},
        "summary": {
            "en": "Gross value added by NACE section: level, share of the economy, and real growth.",
            "ka": "დამატებული ღირებულება NACE სექციების მიხედვით: მოცულობა, წილი და რეალური ზრდა.",
            "ru": "Валовая добавленная стоимость по разделам NACE: объём, доля в экономике и реальный рост.",
        },
    },
    "labour_quarterly": {
        "topic": "labour",
        "title": {"en": "Labour market, quarterly", "ka": "შრომის ბაზარი, კვარტალური", "ru": "Рынок труда, ежеквартально"},
        "summary": {
            "en": "Unemployment, participation and employment rates and levels by sex and urban/rural area.",
            "ka": "უმუშევრობის, აქტიურობისა და დასაქმების დონეები სქესისა და დასახლების ტიპის მიხედვით.",
            "ru": "Уровни безработицы, участия и занятости по полу и типу поселения.",
        },
    },
    "labour_regional_annual": {
        "topic": "labour",
        "title": {"en": "Labour market by region", "ka": "შრომის ბაზარი რეგიონების მიხედვით", "ru": "Рынок труда по регионам"},
        "summary": {
            "en": "Annual unemployment, participation and employment rates and levels by region.",
            "ka": "წლიური უმუშევრობის, აქტიურობისა და დასაქმების მაჩვენებლები რეგიონების მიხედვით.",
            "ru": "Годовые уровни безработицы, участия и занятости по регионам.",
        },
    },
    "population_by_area": {
        "topic": "population",
        "title": {"en": "Population by area", "ka": "მოსახლეობა ტერიტორიების მიხედვით", "ru": "Население по территориям"},
        "summary": {
            "en": "Population on 1 January for the country, regions and municipalities, with each area's level and region.",
            "ka": "მოსახლეობა 1 იანვრის მდგომარეობით: ქვეყანა, რეგიონები და მუნიციპალიტეტები.",
            "ru": "Население на 1 января по стране, регионам и муниципалитетам с указанием уровня и региона.",
        },
    },
    "retail_prices_latest": {
        "topic": "prices",
        "title": {"en": "Latest shop prices", "ka": "ბოლო საცალო ფასები", "ru": "Последние розничные цены"},
        "summary": {
            "en": "Latest average price of each product with its change over a year and since 2020.",
            "ka": "თითოეული პროდუქტის ბოლო საშუალო ფასი და მისი ცვლილება წლის განმავლობაში და 2020 წლიდან.",
            "ru": "Последняя средняя цена каждого товара и её изменение за год и с 2020 года.",
        },
    },
    "inflation_breakdown_monthly": {
        "topic": "prices",
        "title": {"en": "Inflation breakdown", "ka": "ინფლაციის სტრუქტურა", "ru": "Структура инфляции"},
        "summary": {
            "en": "Annual inflation by measure: headline, core, HICP, goods by durability, food, energy and services.",
            "ka": "წლიური ინფლაცია: ძირითადი, საბაზო, ჰარმონიზებული, საქონელი ხანგრძლივობის მიხედვით, სურსათი, ენერგია და მომსახურება.",
            "ru": "Годовая инфляция по показателям: общая, базовая, ИГПЦ, товары по длительности пользования, продукты, энергия и услуги.",
        },
    },
    "tbilisi_property_latest": {
        "topic": "prices",
        "title": {"en": "Tbilisi housing prices, latest quarter", "ka": "თბილისის საცხოვრებლის ფასები, ბოლო კვარტალი", "ru": "Цены на жильё в Тбилиси, последний квартал"},
        "summary": {
            "en": "Median price per m² by district for flats and houses, with the change over a year.",
            "ka": "1 მ²-ის მედიანური ფასი რაიონების მიხედვით ბინებისა და სახლებისთვის, წლიური ცვლილებით.",
            "ru": "Медианная цена м² по районам для квартир и домов и её изменение за год.",
        },
    },
    "business_by_area": {
        "topic": "regions",
        "title": {"en": "Business statistics by area", "ka": "ბიზნეს სტატისტიკა ტერიტორიების მიხედვით", "ru": "Статистика предприятий по территориям"},
        "summary": {
            "en": "Regions and municipalities in one table, with productivity per person employed. Latest year 2022.",
            "ka": "რეგიონები და მუნიციპალიტეტები ერთ ცხრილში, მწარმოებლურობით ერთ დასაქმებულზე. ბოლო წელი 2022.",
            "ru": "Регионы и муниципалитеты в одной таблице, с производительностью на одного занятого. Последний год 2022.",
        },
    },
}
