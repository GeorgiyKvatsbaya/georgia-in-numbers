import json
import tempfile
import unittest
from pathlib import Path

import duckdb
import pandas as pd

from geostat_data.checks import run_checks
from geostat_data.database import initialize, prepare_frame
from geostat_data.export import export
from geostat_data.views import refresh_views

ROMAN_MONTHS = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"]
REGISTRY = {
    "salaries": {
        "table": "salaries_quarterly",
        "topic": "wages",
        "title": {"en": "Salaries", "ka": "ხელფასი", "ru": "Зарплата"},
        "description": {"en": "d", "ka": "d", "ru": "d"},
        "grain": "g",
        "unit": {"en": "GEL", "ka": "ლარი", "ru": "лари"},
    },
    "cpi": {
        "table": "cpi_index_monthly",
        "topic": "prices",
        "title": {"en": "CPI", "ka": "სფი", "ru": "ИПЦ"},
        "description": {"en": "d", "ka": "d", "ru": "d"},
        "grain": "g",
        "unit": {"en": "Index", "ka": "ინდექსი", "ru": "Индекс"},
    },
}


class ExportTests(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = Path(tempfile.mkdtemp())
        self.database = self.directory / "test.duckdb"
        self.registry = self.directory / "datasets.json"
        self.registry.write_text(json.dumps(REGISTRY), encoding="utf-8")
        self.output = self.directory / "out"
        salaries = pd.DataFrame(
            [("Total in country", "Total", str(year), quarter, 1000.0 + year - 2014)
             for year in (2014, 2015) for quarter in ["I", "II", "III", "IV"]],
            columns=["Sex, Sectors", "Economic Activity", "Year", "Quarters", "value"],
        )
        cpi = pd.DataFrame(
            [("Georgia", str(year), month, 100.0 + year - 2014)
             for year in (2014, 2015) for month in ROMAN_MONTHS],
            columns=["Region", "Year", "Month", "value"],
        )
        with duckdb.connect(str(self.database)) as connection:
            initialize(connection)
            for name, frame in [("salaries", salaries), ("cpi", cpi)]:
                connection.register("frame", prepare_frame(frame, name))
                connection.execute(
                    f"CREATE TABLE {REGISTRY[name]['table']} AS SELECT * FROM frame"
                )
                connection.unregister("frame")
                connection.execute(
                    "INSERT INTO metadata.datasets (dataset, table_name, source_url, source_path, "
                    "retrieved_at, row_count) VALUES (?, ?, 'https://example', 'p', now(), 0)",
                    [name, REGISTRY[name]["table"]],
                )
            connection.execute(
                "INSERT INTO metadata.dimensions VALUES "
                "('cpi', 'Region', 'region', 'Region', '0', 'Georgia', 'en'), "
                "('cpi', 'Region', 'region', 'რეგიონი', '0', 'საქართველო', 'ka')"
            )
            refresh_views(connection)

    def test_export_writes_parquet_catalog_and_translations(self) -> None:
        catalog = export(self.database, self.output, self.registry, dashboards={})
        names = {entry["name"] for entry in catalog["objects"]}
        self.assertEqual(names, {"salaries_quarterly", "cpi_index_monthly", "real_wages_quarterly"})
        for entry in catalog["objects"]:
            self.assertTrue((self.output / entry["file"]).exists())
        cpi = next(e for e in catalog["objects"] if e["name"] == "cpi_index_monthly")
        region = next(c for c in cpi["columns"] if c["name"] == "region")
        self.assertEqual(region["values"][0], {"en": "Georgia", "ka": "საქართველო", "ru": "Грузия"})
        self.assertEqual(cpi["last_period"], "2015-12-01")
        with duckdb.connect() as connection:
            rows = connection.execute(
                f"SELECT count(*) FROM '{self.output / 'real_wages_quarterly.parquet'}'"
            ).fetchone()[0]
        self.assertEqual(rows, 8)

    def test_checks_pass_then_flag_a_shrunken_table(self) -> None:
        export(self.database, self.output, self.registry, dashboards={})
        self.assertEqual(run_checks(self.database, self.output / "catalog.json", self.registry), [])
        with duckdb.connect(str(self.database)) as connection:
            connection.execute("DELETE FROM cpi_index_monthly WHERE year = 2015")
        failures = run_checks(self.database, self.output / "catalog.json", self.registry)
        self.assertTrue(any("cpi_index_monthly: non-null values fell" in f for f in failures))
        self.assertTrue(any("latest period went back" in f for f in failures))


if __name__ == "__main__":
    unittest.main()
