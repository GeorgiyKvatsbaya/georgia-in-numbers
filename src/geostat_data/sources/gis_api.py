"""Geostat GeoMap API (https://gis-api.geostat.ge/api): business statistics by region/municipality.

Every endpoint needs `?year=YYYY`; years without data answer 404 or 500. Each indicator was
matched against its PXWeb "Business Statistics" regional table for 2022 to fix definitions and
units. Note the API's names are swapped for employment: `getRegEmployees` is *persons employed*
and `getRegEmployed` is *employees*. The server interpolates `year` into SQL, so only integers
from a fixed range are ever sent.
"""

from __future__ import annotations

from datetime import date

import pandas as pd

from . import SourceResult
from .http import PoliteClient

BASE_URL = "https://gis-api.geostat.ge/api"

# key: (regional endpoint, municipal endpoint, English label, Georgian label)
INDICATORS = {
    "turnover": ("getRegBrunva", "getMunBrunva", "Turnover, million GEL", "ბრუნვა, მლნ ლარი"),
    "value_added": ("getValAdded", "getMunValAdded", "Value added, million GEL", "დამატებული ღირებულება, მლნ ლარი"),
    "production_value": ("getRegProdVal", "getMunProdVal", "Production value, million GEL", "პროდუქციის გამოშვება, მლნ ლარი"),
    "purchases": ("getRegPurchases", "getMunPurchases", "Purchases of goods and services, million GEL", "საქონლისა და მომსახურების შესყიდვები, მლნ ლარი"),
    "resale_purchases": ("getRegResale", "getMunResale", "Purchases for resale, million GEL", "გადასაყიდად შესყიდული საქონელი და მომსახურება, მლნ ლარი"),
    "intermediate_consumption": ("getRegIntConsumption", "getMunIntConsumption", "Intermediate consumption, million GEL", "შუალედური მოხმარება, მლნ ლარი"),
    "investment": ("getRegInvestment", "getMunInvestment", "Investment in fixed assets, million GEL", "ინვესტიციები ძირითად საშუალებებში, მლნ ლარი"),
    "personnel_costs": ("getRegCosts", "getMunCosts", "Personnel costs, million GEL", "პერსონალის ხარჯები, მლნ ლარი"),
    "average_remuneration": ("getRegRemuneration", "getMunRemuneration", "Average monthly remuneration, GEL", "საშუალო თვიური შრომის ანაზღაურება, ლარი"),
    "persons_employed": ("getRegEmployees", "getMunEmployees", "Persons employed", "დასაქმებულთა რაოდენობა"),
    "employees": ("getRegEmployed", "getMunEmployed", "Employees", "დაქირავებულთა რაოდენობა"),
}

REGION_NAMES = {
    "11": "Tbilisi",
    "15": "Adjara A.R.",
    "23": "Guria",
    "26": "Imereti",
    "29": "Kakheti",
    "32": "Mtskheta-Mtianeti",
    "35": "Racha-Lechkhumi and Kvemo Svaneti",
    "38": "Samegrelo-Zemo Svaneti",
    "41": "Samtskhe-Javakheti",
    "44": "Kvemo Kartli",
    "47": "Shida Kartli",
}
# Spelling fixes for English municipality names returned by the API.
MUNICIPALITY_FIXES = {
    "C. Foti": "C. Poti",
    "Tsalendjikha": "Tsalenjikha",
    "Dedophlistskaro": "Dedoplistskaro",
    "Zestaphoni": "Zestaponi",
    "Sagaredjo": "Sagarejo",
    "Tbilisi": "C. Tbilisi",
}
FIRST_YEAR = {"region": 2006, "municipality": 2010}


def _years(level: str) -> list[int]:
    return list(range(FIRST_YEAR[level], date.today().year + 1))


def _value(row: dict, year: int) -> float | None:
    value = row.get(f"w_{year}", row.get("value"))
    return None if value is None else float(value)


def fetch(level: str, client: PoliteClient | None = None) -> SourceResult:
    """All indicators for every available year at `level` ('region' or 'municipality')."""
    client = client or PoliteClient(BASE_URL, delay=0.3)
    area_column = "region" if level == "region" else "municipality"
    rows, labels, area_names = [], [], {}
    for region_endpoint, municipal_endpoint, label_en, label_ka in INDICATORS.values():
        endpoint = region_endpoint if level == "region" else municipal_endpoint
        # Dimension values are stored as English labels, so labels are keyed by them too.
        labels.append(("indicator", label_en, label_en, label_ka))
        for year in _years(level):
            response = client.get(endpoint, {"year": str(int(year))})
            if response.status_code != 200:
                continue
            for record in response.json():
                code = str(record.get("region_id") or record.get("municipal_") or "").strip()
                if level == "region" and code not in REGION_NAMES:
                    continue  # occupied territories: no code or no data
                if level == "municipality" and not code:
                    continue
                value = _value(record, year)
                if value is None:
                    continue
                if level == "region":
                    name = REGION_NAMES[code]
                else:
                    raw = " ".join(str(record["name_en"]).split())
                    name = MUNICIPALITY_FIXES.get(raw, raw)
                area_names[code] = (name, " ".join(str(record["name_ge"]).split()))
                row = {
                    "indicator": label_en,
                    area_column: name,
                    f"{area_column}_code": code,
                    "year": year,
                    "value": value,
                }
                if level == "municipality":
                    row["region_code"] = code[:2]
                rows.append(row)
    labels += [(area_column, name, name, ka) for name, ka in area_names.values()]
    frame = pd.DataFrame(rows)
    columns = ["indicator", area_column, f"{area_column}_code"]
    if level == "municipality":
        columns.append("region_code")
    frame = frame[columns + ["year", "value"]] if not frame.empty else frame
    endpoints = ", ".join(
        (r if level == "region" else m) for r, m, *_ in INDICATORS.values()
    )
    return SourceResult(frame, client.url(""), f"{endpoints} ?year=YYYY", labels)
