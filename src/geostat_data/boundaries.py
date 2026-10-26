"""Map boundaries from Geostat's GeoServer, simplified for the web.

Boundaries rarely change, so this runs on demand (`geostat boundaries`) and the output is
committed; it is not part of the weekly refresh. Feature ids match the data:
regions -> GeoMap `region_id`, municipalities -> GeoMap `municipal_` (GeoServer MUNICIPAL1),
Tbilisi districts -> English district name used by the prices API ("Gldani", "Vake", …).
Tbilisi districts come from the municipal layer (cleaner than the settlement layer).
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from shapely import make_valid, set_precision
from shapely.geometry import MultiPolygon, Polygon, mapping, shape
from shapely.ops import unary_union

from .database import PROJECT_ROOT
from .sources.gis_api import MUNICIPALITY_FIXES, REGION_NAMES
from .sources.http import PoliteClient

WFS_URL = "https://gis-geoserver.geostat.ge/geoserver/geostat/wfs"
DEFAULT_GEO_OUTPUT = PROJECT_ROOT / "web" / "public" / "data" / "geo"
OCCUPIED = "Occupied territories"
OCCUPIED_ID = "occupied"
TBILISI = "11"
# Self-governing towns whose statistics are included in the surrounding municipality.
MERGED_TOWNS = {"2311", "2911", "3211", "3511", "3811", "4111", "4711"}
# Degrees; ~0.002° is ~200 m — invisible at country scale, keeps files small.
TOLERANCE = {"regions": 0.002, "municipalities": 0.0015, "tbilisi_districts": 0.0005}
PRECISION = 0.0001


def fetch_layer(client: PoliteClient, layer: str) -> list[dict[str, Any]]:
    params = {
        "service": "WFS",
        "version": "1.0.0",
        "request": "GetFeature",
        "typeName": f"geostat:{layer}",
        "outputFormat": "application/json",
        "srsname": "EPSG:4326",
    }
    return client.get_json("", params)["features"]


def polygonal(geometry):
    """Keep only polygon parts: make_valid / set_precision can emit GeometryCollections with
    stray lines or points, which web map renderers reject."""
    if isinstance(geometry, Polygon | MultiPolygon):
        return geometry
    parts = [
        part
        for item in getattr(geometry, "geoms", [])
        for part in (item.geoms if isinstance(item, MultiPolygon) else [item])
        if isinstance(part, Polygon) and not part.is_empty
    ]
    return parts[0] if len(parts) == 1 else MultiPolygon(parts)


def simplify(geometry, tolerance: float):
    geometry = make_valid(geometry).simplify(tolerance, preserve_topology=True)
    return polygonal(set_precision(polygonal(geometry), PRECISION))


def feature(geometry, properties: dict[str, Any]) -> dict[str, Any]:
    return {"type": "Feature", "properties": properties, "geometry": mapping(geometry)}


def collection(features: list[dict[str, Any]]) -> dict[str, Any]:
    return {"type": "FeatureCollection", "features": features}


def build_regions(raw: list[dict[str, Any]]) -> dict[str, Any]:
    features = []
    for item in raw:
        props = item["properties"]
        code = str(props["REGION_ID"]).strip()
        known = code in REGION_NAMES
        features.append(
            feature(
                simplify(shape(item["geometry"]), TOLERANCE["regions"]),
                {
                    "id": code if known else OCCUPIED_ID,
                    "name_en": REGION_NAMES[code] if known else OCCUPIED,
                    "name_ka": " ".join(props["NAME_GE"].split()),
                },
            )
        )
    return collection(features)


def _municipal_parts(raw: list[dict[str, Any]]):
    """Split the municipal layer into Tbilisi district features and everything else."""
    tbilisi, others = [], []
    for item in raw:
        props = item["properties"]
        target = tbilisi if str(props.get("REGION_ID")).strip() == TBILISI else others
        target.append(item)
    return tbilisi, others


def build_municipalities(raw: list[dict[str, Any]]) -> dict[str, Any]:
    """Municipalities and self-governing cities; Tbilisi as one unit, as in the GeoMap data."""
    tbilisi, others = _municipal_parts(raw)
    # Towns like "C. Ozurgeti" are published inside their municipality ("Ozurgeti
    # Municipality"); merge their shapes so the map has no holes. Cities with their own
    # statistics (Batumi, Kutaisi, Poti, Rustavi) are not in MERGED_TOWNS and stay separate.
    by_name = {
        " ".join(str(i["properties"].get("Name_EN") or "").split()): i for i in others
    }
    merged: dict[str, list] = {}
    for item in list(others):
        props = item["properties"]
        code = str(props.get("MUNICIPAL1") or "").strip()
        if code in MERGED_TOWNS:
            town = " ".join(str(props["Name_EN"]).split()).removeprefix("C. ")
            parent = by_name[f"{town} Municipality"]
            merged.setdefault(id(parent), []).append(make_valid(shape(item["geometry"])))
            others.remove(item)
    for item in others:
        if id(item) in merged:
            item["geometry"] = mapping(
                unary_union([make_valid(shape(item["geometry"])), *merged[id(item)]])
            )
    features = []
    for item in others:
        props = item["properties"]
        code = str(props.get("MUNICIPAL1") or "").strip()
        name_en = " ".join(str(props.get("Name_EN") or "").split())
        features.append(
            feature(
                simplify(shape(item["geometry"]), TOLERANCE["municipalities"]),
                {
                    "id": code or OCCUPIED_ID,
                    "region_id": str(props.get("REGION_ID") or "").strip(),
                    "name_en": MUNICIPALITY_FIXES.get(name_en, name_en) if code else name_en,
                    "name_ka": " ".join(str(props.get("Name_GE") or "").split()),
                },
            )
        )
    city = unary_union([make_valid(shape(item["geometry"])) for item in tbilisi])
    features.append(
        feature(
            simplify(city, TOLERANCE["municipalities"]),
            {"id": TBILISI, "region_id": TBILISI, "name_en": "C. Tbilisi", "name_ka": "ქ. თბილისი"},
        )
    )
    return collection(features)


def build_tbilisi_districts(raw: list[dict[str, Any]]) -> dict[str, Any]:
    """Tbilisi's 10 districts, id = English name as used by the prices API ("Gldani")."""
    tbilisi, _ = _municipal_parts(raw)
    features = []
    for item in sorted(tbilisi, key=lambda i: i["properties"]["Name_EN"]):
        props = item["properties"]
        name = " ".join(str(props["Name_EN"]).split()).removesuffix(" District")
        features.append(
            feature(
                simplify(shape(item["geometry"]), TOLERANCE["tbilisi_districts"]),
                {"id": name, "name_en": name, "name_ka": " ".join(str(props["Name_GE"]).split())},
            )
        )
    return collection(features)


LAYERS = {
    "regions": ("georgiaRegionMain", build_regions),
    "municipalities": ("georgiaMunicMain", build_municipalities),
    "tbilisi_districts": ("georgiaMunicMain", build_tbilisi_districts),
}


def build_boundaries(output: Path = DEFAULT_GEO_OUTPUT) -> dict[str, int]:
    """Download, simplify and write every layer; returns bytes written per file."""
    client = PoliteClient(WFS_URL, delay=0.5, timeout=180)
    output.mkdir(parents=True, exist_ok=True)
    layers = {layer: fetch_layer(client, layer) for layer in {layer for layer, _ in LAYERS.values()}}
    sizes = {}
    for name, (layer, build) in LAYERS.items():
        geojson = build(layers[layer])
        target = output / f"{name}.json"
        target.write_text(json.dumps(geojson, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        sizes[name] = target.stat().st_size
    return sizes
