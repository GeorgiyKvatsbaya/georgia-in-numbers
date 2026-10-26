"""Geostat price statistics portal API (https://prices-api.geostat.ge/api).

Index bases were checked against the data and against PXWeb when the API did not state them:
PPI 2020 average = 100; CPI components December 2020 = 100 (their weighted level tracks the
PXWeb CPI relative to Dec 2020); construction cost index February 2022 = 100 (first month).
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import date

import pandas as pd

from . import SourceResult
from .http import PoliteClient

BASE_URL = "https://prices-api.geostat.ge/api"

# Codes the API returns without names. Names follow the Geostat prices portal.
MEASURES = {
    "CPI": ("Headline CPI inflation", "სამომხმარებლო ფასების ინდექსი (ინფლაცია)"),
    "CORE": ("Core inflation", "საბაზო ინფლაცია"),
    "HICP": ("Harmonised CPI (HICP)", "ჰარმონიზებული სამომხმარებლო ფასების ინდექსი"),
}
DURABILITY = {
    "ND": ("Non-durable goods", "არა ხანგრძლივი მოხმარების საქონელი"),
    "SD": ("Semi-durable goods", "საშუალო ხანგრძლივობის მოხმარების საქონელი"),
    "D": ("Durable goods", "ხანგრძლივი მოხმარების საქონელი"),
    "S": ("Services", "მომსახურება"),
}
PPI_SERIES = {
    "TOTAL": ("Producer price index, industrial products", "მწარმოებელთა ფასების ინდექსი, სამრეწველო პროდუქცია"),
    "DOMESTIC": ("Domestic producer price index", "ადგილობრივი მწარმოებელთა ფასების ინდექსი"),
    "EXPORT": ("Export price index", "ექსპორტის ფასების ინდექსი"),
    "IMPORT": ("Import price index", "იმპორტის ფასების ინდექსი"),
    "SUPPLY": ("Domestic supply price index", "ადგილობრივი მიწოდების ფასების ინდექსი"),
    "TRANSPORT": ("Services PPI: transport and storage", "მომსახურების PPI: ტრანსპორტი და დასაწყობება"),
    "ACCOM_FOOD": ("Services PPI: accommodation and food", "მომსახურების PPI: განთავსება და კვება"),
    "TELECOM": ("Services PPI: telecommunication", "მომსახურების PPI: ტელეკომუნიკაცია"),
}
DWELLING_TYPES = {
    "APARTMENT": ("Flats", "ბინები"),
    "HOUSE": ("Detached houses", "ინდივიდუალური სახლები"),
}
AGRO_MEASURES = {
    "change_qoq": ("Change vs previous quarter, %", "ცვლილება წინა კვარტალთან, %"),
    "change_yoy": ("Change vs same quarter of previous year, %", "ცვლილება წინა წლის შესაბამის კვარტალთან, %"),
}
BASKET_CLASSIFICATIONS = {
    "coicop": ("COICOP division", "COICOP განყოფილება"),
    "durability": ("Durability", "ხანგრძლივობა"),
    "origin": ("Origin", "წარმოშობა"),
}
FIRST_BASKET_YEAR = 2012


def _labels(column: str, names: dict[str, tuple[str, str]]) -> list[tuple[str, str, str, str]]:
    return [(column, code, en, ka) for code, (en, ka) in names.items()]


def _result(client: PoliteClient, endpoints: str, rows: list[dict], labels) -> SourceResult:
    return SourceResult(
        frame=pd.DataFrame(rows),
        source_url=client.url(""),
        source_path=endpoints,
        labels=labels,
    )


def retail_prices(client: PoliteClient) -> SourceResult:
    """Average shop price of each product, monthly since 2020 (GEL per stated unit)."""
    products = client.get_json("avg-prices")
    rows, labels = [], []
    for product in products:
        name = product["product_name_en"].strip()
        group = product["category_en"].strip()
        unit = product["unit_of_measure_en"].strip()
        labels += [
            ("product", str(product["product_id"]), name, product["product_name_ka"].strip()),
            ("product_group", group, group, product["category_ka"].strip()),
            ("unit_of_measure", unit, unit, product["unit_of_measure"].strip()),
        ]
        for point in client.get_json(f"product-history/{product['product_id']}"):
            rows.append(
                {
                    "product": name,
                    "product_group": group,
                    "unit_of_measure": unit,
                    "year": point["year"],
                    "month": point["month"],
                    "value": point["price"],
                }
            )
    return _result(client, "avg-prices; product-history/{product_id}", rows, labels)


def inflation_measures(client: PoliteClient) -> SourceResult:
    """Headline, core and harmonised inflation plus inflation by durability class (% YoY)."""
    rows = [
        {"measure": MEASURES[r["indicator_code"]][0], "year": r["year"], "month": r["month"], "value": r["value"]}
        for r in client.get_json("inflation")
        if r["indicator_code"] in MEASURES and r.get("change_type", "YoY") == "YoY"
    ]
    rows += [
        {"measure": DURABILITY[r["class_code"]][0], "year": r["year"], "month": r["month"], "value": r["value"]}
        for r in client.get_json("inflation-by-classification", {"type": "DURABILITY"})
        if r["class_code"] in DURABILITY
    ]
    names = {en: (en, ka) for en, ka in [*MEASURES.values(), *DURABILITY.values()]}
    return _result(client, "inflation; inflation-by-classification?type=DURABILITY", rows, _labels("measure", names))


def inflation_components(client: PoliteClient) -> SourceResult:
    """CPI components (food, energy, non-energy goods, services) as indices, Dec 2020 = 100."""
    rows, names = [], {}
    for r in client.get_json("inflation-index"):
        name = r["indicator_name_en"].strip()
        names[name] = (name, r["indicator_name_ka"].strip())
        rows.append({"component": name, "year": r["year"], "month": r["month"], "value": r["value"]})
    return _result(client, "inflation-index", rows, _labels("component", names))


def basket_weights(client: PoliteClient) -> SourceResult:
    """Consumer basket weights by COICOP division, durability and origin (% of basket)."""
    rows, names = [], {}
    for year in range(FIRST_BASKET_YEAR, date.today().year + 1):
        response = client.get("basket-weights", {"year": year})
        if response.status_code != 200:
            continue
        payload = response.json()
        groups = [("coicop", payload.get("bars", []), "product_name"), ("durability", payload.get("durability", []), "class_name"), ("origin", payload.get("origin", []), "class_name")]
        for classification, items, prefix in groups:
            for item in items:
                name = item[f"{prefix}_en"].strip()
                names[name] = (name, item[f"{prefix}_ka"].strip())
                rows.append(
                    {
                        "classification": BASKET_CLASSIFICATIONS[classification][0],
                        "item": name,
                        "year": year,
                        "value": round(100 * item["weight_value"], 4),
                    }
                )
    labels = _labels("item", names) + _labels(
        "classification", {en: (en, ka) for en, ka in BASKET_CLASSIFICATIONS.values()}
    )
    return _result(client, "basket-weights?year={year}", rows, labels)


def producer_prices(client: PoliteClient) -> SourceResult:
    """Producer, export, import and services price indices, 2020 average = 100."""
    rows = [
        {"series": PPI_SERIES[r["category_code"]][0], "year": r["year"], "month": r["month"], "value": r["index_value"]}
        for r in client.get_json("ppi-breakdown")
        if r["category_code"] in PPI_SERIES
    ]
    names = {en: (en, ka) for en, ka in PPI_SERIES.values()}
    return _result(client, "ppi-breakdown", rows, _labels("series", names))


def construction_costs(client: PoliteClient) -> SourceResult:
    """Construction cost index by component, February 2022 = 100."""
    rows, names = [], {}
    for r in client.get_json("cci-breakdown"):
        name = r["category_name_en"].strip()
        names[name] = (name, r["category_name_ka"].strip())
        rows.append({"component": name, "year": r["year"], "month": r["month"], "value": r["index_value"]})
    return _result(client, "cci-breakdown", rows, _labels("component", names))


def agro_prices(client: PoliteClient) -> SourceResult:
    """Unit value index of agricultural products: quarterly % changes."""
    rows = [
        {"measure": AGRO_MEASURES[key][0], "year": r["year"], "quarter": r["quarter"], "value": r[key]}
        for r in client.get_json("agro-chart")
        for key in AGRO_MEASURES
    ]
    names = {en: (en, ka) for en, ka in AGRO_MEASURES.values()}
    return _result(client, "agro-chart", rows, _labels("measure", names))


def tbilisi_property(client: PoliteClient) -> SourceResult:
    """Median price per m² (GEL) of residential property by Tbilisi district, quarterly."""
    rows, names = [], {}
    for category, (type_en, _) in DWELLING_TYPES.items():
        for r in client.get_json("tbilisi-district-prices", {"category": category}):
            # "Gldani District" -> "Gldani" to match the boundary file. The Georgian name keeps
            # "რაიონი": without it the genitive form ("გლდანის") reads as incomplete.
            name = r["location_name_en"].removesuffix(" District").strip()
            names[name] = (name, r["location_name"].strip())
            rows.append(
                {
                    "district": name,
                    "dwelling_type": type_en,
                    "year": r["year"],
                    "quarter": r["quarter"],
                    "value": r["median_price"],
                }
            )
    labels = _labels("district", names) + _labels(
        "dwelling_type", {en: (en, ka) for en, ka in DWELLING_TYPES.values()}
    )
    return _result(client, "tbilisi-district-prices?category=APARTMENT|HOUSE", rows, labels)


RESOURCES: dict[str, Callable[[PoliteClient], SourceResult]] = {
    "retail_prices": retail_prices,
    "inflation_measures": inflation_measures,
    "inflation_components": inflation_components,
    "basket_weights": basket_weights,
    "producer_prices": producer_prices,
    "construction_costs": construction_costs,
    "agro_prices": agro_prices,
    "tbilisi_property": tbilisi_property,
}


def fetch(resource: str, client: PoliteClient | None = None) -> SourceResult:
    return RESOURCES[resource](client or PoliteClient(BASE_URL))
