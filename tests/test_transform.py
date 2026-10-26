import unittest

import duckdb
import pandas as pd

from geostat_data.client import GeostatClient, jsonstat_to_frame
from geostat_data.database import parse_period, prepare_frame, resolve_path, sql_name
from geostat_data.views import refresh_views

ROMAN_MONTHS = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"]


class JsonStatTests(unittest.TestCase):
    def test_json_stat_1_becomes_tidy_frame(self) -> None:
        payload = {
            "dataset": {
                "dimension": {
                    "Region": {
                        "category": {
                            "index": {"0": 0, "1": 1},
                            "label": {"0": "Georgia", "1": "Tbilisi"},
                        }
                    },
                    "Year": {
                        "category": {"index": {"0": 0}, "label": {"0": "2025"}}
                    },
                    "id": ["Region", "Year"],
                    "size": [2, 1],
                },
                "value": [100.5, 101.0],
            }
        }
        frame = jsonstat_to_frame(payload)
        self.assertEqual(frame.to_dict("records"), [
            {"Region": "Georgia", "Year": "2025", "value": 100.5},
            {"Region": "Tbilisi", "Year": "2025", "value": 101.0},
        ])

    def test_sql_names_and_inflation_derivation(self) -> None:
        frame = pd.DataFrame({"Regions": ["Georgia"], "Years": [2025], "value": [105.82]})
        result = prepare_frame(frame, "inflation")
        self.assertEqual(
            list(result.columns),
            ["dataset", "region", "year", "value", "period_type", "period_start", "quarter_num",
             "month_num", "is_preliminary", "inflation_rate"],
        )
        self.assertEqual(result.loc[0, "inflation_rate"], 5.82)
        self.assertEqual(sql_name("Sex, Sectors"), "sex_sectors")

    def test_table_urls_get_trailing_slash(self) -> None:
        client = GeostatClient()
        self.assertTrue(client._url("Social Statistics/Labour/Wages_Nace2.px").endswith(".px/"))
        self.assertTrue(client._url("Social Statistics/Labour").endswith("/Labour"))


class PeriodTests(unittest.TestCase):
    def test_parse_period_formats(self) -> None:
        cases = [
            ({"period": "I 26*"}, (2026, "quarter", 1, None, True)),
            ({"period": "II  23"}, (2023, "quarter", 2, None, False)),
            ({"period": "2025*"}, (2025, "annual", None, None, True)),
            ({"year": 2024, "quarter": "Q III"}, (2024, "quarter", 3, None, False)),
            ({"year": 2024, "quarter": "Q I-IV"}, (2024, "annual", None, None, False)),
            ({"year": 2024, "quarter": "Annual"}, (2024, "annual", None, None, False)),
            ({"year": 2024, "month": "XI"}, (2024, "month", 4, 11, False)),
            ({"year": 2020, "month": "March"}, (2020, "month", 1, 3, False)),
            ({"year": 2020, "month": "Total"}, (2020, "annual", None, None, False)),
            ({"year": 2019}, (2019, "annual", None, None, False)),
        ]
        for row, expected in cases:
            with self.subTest(row=row):
                self.assertEqual(parse_period(row), expected)

    def test_prepare_frame_adds_period_start_and_cleans_labels(self) -> None:
        frame = pd.DataFrame(
            {
                "Indicator": ["B.1*g  (=) GDP", "B.1*g (=) GDP", "Exports"],
                "Period": ["I 26*", "I 26*", "2025*"],
                "value": [10.0, 10.0, 5.0],
            }
        ).astype({"Indicator": "string", "Period": "string"})
        result = prepare_frame(frame, "gdp_use")
        # The two labels differ only by whitespace and carry the same value: one row survives.
        self.assertEqual(len(result), 2)
        first = result.iloc[0]
        self.assertEqual(first["indicator"], "B.1*g (=) GDP")
        self.assertEqual(str(first["period_start"]), "2026-01-01")
        self.assertTrue(first["is_preliminary"])
        self.assertEqual(result.iloc[1]["period_type"], "annual")

    def test_resolve_path_finds_renamed_table(self) -> None:
        class FakeClient:
            def catalog(self, path: str) -> list[dict]:
                return [
                    {"id": "LFS_by_regions.px", "type": "t"},
                    {"id": "LFS_by_sex_and_urban_(Quarter_II,_2026).px", "type": "t"},
                ]

        definition = {"folder": "Social Statistics/Labour", "match": "^LFS_by_sex_and_urban_"}
        self.assertEqual(
            resolve_path(definition, FakeClient()),
            "Social Statistics/Labour/LFS_by_sex_and_urban_(Quarter_II,_2026).px",
        )


class RealWageViewTests(unittest.TestCase):
    def setUp(self) -> None:
        self.connection = duckdb.connect()
        # CPI: 100 throughout 2014, 110 throughout 2015, 2016 has only January.
        cpi = [("Georgia", 2014, month, 100.0) for month in ROMAN_MONTHS]
        cpi += [("Georgia", 2015, month, 110.0) for month in ROMAN_MONTHS]
        cpi += [("Georgia", 2016, "I", 120.0), ("Tbilisi", 2014, "I", 999.0)]
        self.connection.execute(
            "CREATE TABLE cpi_index_monthly (region VARCHAR, year BIGINT, month VARCHAR, value DOUBLE)"
        )
        self.connection.executemany("INSERT INTO cpi_index_monthly VALUES (?, ?, ?, ?)", cpi)
        salaries = [("Total in country", "Total", 2014, q, 1000.0) for q in ["I", "II", "III", "IV"]]
        salaries += [
            ("Total in country", "Total", 2014, "annual", 900.0),
            ("Total in country", "Total", 2015, "I", 1210.0),
            ("Total in country", "Total", 2015, "annual", 1089.0),
            ("Total in country", "Total", 2016, "I", 1300.0),
        ]
        self.connection.execute(
            "CREATE TABLE salaries_quarterly (sex_sectors VARCHAR, economic_activity VARCHAR, "
            "year BIGINT, quarter VARCHAR, value DOUBLE)"
        )
        self.connection.executemany("INSERT INTO salaries_quarterly VALUES (?, ?, ?, ?, ?)", salaries)
        self.assertEqual(refresh_views(self.connection), ["real_wages_quarterly"])

    def row(self, year: int, quarter: str) -> dict:
        frame = self.connection.execute(
            "SELECT * FROM real_wages_quarterly WHERE year = ? AND quarter = ?", [year, quarter]
        ).df()
        self.assertEqual(len(frame), 1)
        return frame.iloc[0].to_dict()

    def test_deflates_and_indexes_quarterly_rows(self) -> None:
        row = self.row(2015, "I")
        self.assertEqual(row["real_salary_gel_2010"], 1100.0)
        self.assertEqual(row["real_wage_index_2014"], 110.0)
        self.assertEqual(row["nominal_yoy_pct"], 21.0)
        self.assertEqual(row["cpi_yoy_pct"], 10.0)
        self.assertEqual(row["real_yoy_pct"], 10.0)
        self.assertEqual(row["period_start"].month, 1)

    def test_annual_rows_use_their_own_base(self) -> None:
        row = self.row(2015, "annual")
        self.assertEqual(row["period_type"], "annual")
        self.assertEqual(row["real_wage_index_2014"], 110.0)  # 990 / 900, not 990 / 1000

    def test_incomplete_cpi_period_leaves_real_values_null(self) -> None:
        row = self.row(2016, "I")
        self.assertEqual(row["nominal_salary_gel"], 1300.0)
        self.assertTrue(pd.isna(row["real_salary_gel_2010"]))
        self.assertTrue(pd.isna(row["real_yoy_pct"]))


if __name__ == "__main__":
    unittest.main()
