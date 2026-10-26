import unittest

import duckdb
import pandas as pd

from geostat_data.client import GeostatClient, jsonstat_to_frame
from geostat_data.database import prepare_frame, refresh_views, sql_name

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
        self.assertEqual(list(result.columns), ["dataset", "region", "year", "value", "inflation_rate"])
        self.assertEqual(result.loc[0, "inflation_rate"], 5.82)
        self.assertEqual(sql_name("Sex, Sectors"), "sex_sectors")

    def test_table_urls_get_trailing_slash(self) -> None:
        client = GeostatClient()
        self.assertTrue(client._url("Social Statistics/Labour/Wages_Nace2.px").endswith(".px/"))
        self.assertTrue(client._url("Social Statistics/Labour").endswith("/Labour"))


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
