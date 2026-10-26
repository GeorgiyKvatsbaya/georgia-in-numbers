import json
import unittest
from pathlib import Path

from shapely.geometry import box, mapping, shape

from geostat_data.boundaries import build_municipalities, build_tbilisi_districts
from geostat_data.database import prepare_frame
from geostat_data.sources import gis_api, prices_api

FIXTURES = Path(__file__).parent / "fixtures"


class FakeResponse:
    def __init__(self, payload, status_code: int = 200) -> None:
        self.payload = payload
        self.status_code = status_code

    def json(self):
        return self.payload

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise RuntimeError(self.status_code)


class FakeClient:
    """Serves recorded responses: `<path>[_<param>_<value>].json` under a fixture folder."""

    def __init__(self, folder: str) -> None:
        self.folder = FIXTURES / folder
        self.calls: list[tuple[str, dict]] = []

    def url(self, path: str) -> str:
        return f"https://example.test/{path}"

    def get(self, path: str, params=None) -> FakeResponse:
        self.calls.append((path, params or {}))
        suffix = "".join(f"_{key}_{value}" for key, value in (params or {}).items())
        file = self.folder / f"{path.replace('/', '_')}{suffix}.json"
        if not file.exists():
            return FakeResponse(None, 500)
        return FakeResponse(json.loads(file.read_text(encoding="utf-8")))

    def get_json(self, path: str, params=None):
        response = self.get(path, params)
        response.raise_for_status()
        return response.json()


class PricesApiTests(unittest.TestCase):
    def test_retail_prices_join_history_and_labels(self) -> None:
        result = prices_api.retail_prices(FakeClient("prices_api"))
        frame = prepare_frame(result.frame, "retail_prices")
        self.assertEqual(set(frame["product"]), {"Rice", "Sour cream"})
        latest = frame[(frame["product"] == "Sour cream") & (frame["period_type"] == "month")]
        self.assertEqual(str(latest["period_start"].max()), "2026-09-01")
        georgian = {(c, en): ka for c, _, en, ka in result.labels}
        self.assertEqual(georgian[("product", "Rice")], "ბრინჯი")
        self.assertEqual(georgian[("unit_of_measure", "1 kilogram")], "1 კილოგრამი")

    def test_producer_prices_name_codes(self) -> None:
        result = prices_api.producer_prices(FakeClient("prices_api"))
        self.assertIn("Export price index", set(result.frame["series"]))
        self.assertNotIn("EXPORT", set(result.frame["series"]))

    def test_tbilisi_property_both_dwelling_types_and_quarters(self) -> None:
        result = prices_api.tbilisi_property(FakeClient("prices_api"))
        frame = prepare_frame(result.frame, "tbilisi_property")
        self.assertEqual(set(frame["dwelling_type"]), {"Flats", "Detached houses"})
        self.assertIn("Gldani", set(frame["district"]))
        self.assertEqual(set(frame["period_type"]), {"quarter"})
        self.assertTrue(frame["quarter_num"].between(1, 4).all())


class GisApiTests(unittest.TestCase):
    def test_regions_use_codes_drop_occupied_and_skip_failing_years(self) -> None:
        client = FakeClient("gis_api")
        result = gis_api.fetch("region", client)
        frame = result.frame
        self.assertEqual(set(frame["year"]), {2022})
        self.assertNotIn("12", set(frame["region_code"]))
        self.assertIn("Shida Kartli", set(frame["region"]))  # API spells it "Shda Kartli"
        # getRegEmployees holds persons employed (verified against PXWeb).
        employed = frame[frame["indicator"] == "Persons employed"]
        adjara = employed.loc[employed["region"] == "Adjara A.R.", "value"].item()
        self.assertAlmostEqual(adjara, 75232.4)
        # Only whole years are ever sent to the API.
        self.assertTrue(all(params["year"].isdigit() for _, params in client.calls))

    def test_municipalities_clean_names_and_region_codes(self) -> None:
        frame = gis_api.fetch("municipality", FakeClient("gis_api")).frame
        names = set(frame["municipality"])
        self.assertIn("C. Poti", names)  # API spells it "C. Foti"
        self.assertIn("Samtredia", names)  # API adds a trailing CRLF
        self.assertEqual(frame.loc[frame["municipality"] == "C. Batumi", "region_code"].iloc[0], "15")


def _feature(code: str, region: str, name: str, geometry) -> dict:
    return {
        "type": "Feature",
        "geometry": mapping(geometry),
        "properties": {"MUNICIPAL1": code, "REGION_ID": region, "Name_EN": name, "Name_GE": name},
    }


def _municipal_layer() -> list[dict]:
    return [
        _feature("1125", "11", "Gldani District", box(0, 0, 1, 1)),
        _feature("1133", "11", "Vake District", box(1, 0, 2, 1)),
        _feature("2325", "23", "Ozurgeti Municipality", box(3, 0, 4, 1)),
        _feature("2311", "23", "C. Ozurgeti", box(4, 0, 5, 1)),
        _feature("", "", "Abkhazia A.R.", box(6, 0, 7, 1)),
    ]


class BoundaryTests(unittest.TestCase):

    def test_municipalities_merge_towns_and_tbilisi(self) -> None:
        features = {f["properties"]["id"]: f for f in build_municipalities(_municipal_layer())["features"]}
        self.assertEqual(set(features), {"2325", "11", "occupied"})
        self.assertAlmostEqual(shape(features["2325"]["geometry"]).area, 2.0, places=3)
        self.assertAlmostEqual(shape(features["11"]["geometry"]).area, 2.0, places=3)

    def test_only_polygon_geometries(self) -> None:
        from shapely.geometry import GeometryCollection, LineString

        from geostat_data.boundaries import polygonal

        mixed = GeometryCollection([box(0, 0, 1, 1), LineString([(2, 2), (3, 3)]), box(4, 4, 5, 5)])
        self.assertEqual(polygonal(mixed).geom_type, "MultiPolygon")
        for feature in build_municipalities(_municipal_layer())["features"]:
            self.assertIn(feature["geometry"]["type"], {"Polygon", "MultiPolygon"})

    def test_tbilisi_districts_use_prices_api_names(self) -> None:
        ids = [f["properties"]["id"] for f in build_tbilisi_districts(_municipal_layer())["features"]]
        self.assertEqual(ids, ["Gldani", "Vake"])


class PeriodTests(unittest.TestCase):
    def test_integer_months_and_quarters(self) -> None:
        import pandas as pd

        frame = pd.DataFrame(
            {"product": ["a", "a"], "year": [2026, 2026], "month": [9, 12], "value": [1.0, 2.0]}
        )
        result = prepare_frame(frame, "retail_prices")
        self.assertEqual([str(d) for d in result["period_start"]], ["2026-09-01", "2026-12-01"])
        quarters = prepare_frame(
            pd.DataFrame({"district": ["x"], "year": [2026], "quarter": [3], "value": [1.0]}), "t"
        )
        self.assertEqual(str(quarters["period_start"].iloc[0]), "2026-07-01")


if __name__ == "__main__":
    unittest.main()
