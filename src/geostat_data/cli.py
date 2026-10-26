from __future__ import annotations

import argparse
import json
from pathlib import Path

from .client import GeostatClient
from .database import DEFAULT_DATABASE, database_overview, load_registry, sync_dataset


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description="Browse and download Geostat PXWeb tables")
    result.add_argument("--language", default="en", choices=["en", "ka"])
    subparsers = result.add_subparsers(dest="command", required=True)

    catalog = subparsers.add_parser("catalog", help="List folders and tables")
    catalog.add_argument("path", nargs="?", default="")

    metadata = subparsers.add_parser("metadata", help="Show table dimensions and values")
    metadata.add_argument("table_path")

    fetch = subparsers.add_parser("fetch", help="Download a table as tidy CSV")
    fetch.add_argument("table_path")
    fetch.add_argument("--output", type=Path, required=True)
    fetch.add_argument(
        "--select",
        action="append",
        default=[],
        metavar="DIMENSION=ID,ID",
        help="Repeat to restrict dimensions; IDs are shown by the metadata command",
    )

    sync = subparsers.add_parser("sync", help="Load selected registered datasets into DuckDB")
    sync.add_argument("datasets", nargs="+", help="Names from datasets.json, or 'all'")
    sync.add_argument("--database", type=Path, default=DEFAULT_DATABASE)

    overview = subparsers.add_parser("describe-db", help="Print LLM-friendly database context")
    overview.add_argument("--database", type=Path, default=DEFAULT_DATABASE)
    return result


def parse_selections(items: list[str]) -> dict[str, list[str]]:
    selections = {}
    for item in items:
        if "=" not in item:
            raise ValueError(f"Invalid selection {item!r}; expected DIMENSION=ID,ID")
        dimension, values = item.split("=", 1)
        selections[dimension] = [value for value in values.split(",") if value]
    return selections


def main() -> None:
    args = parser().parse_args()
    client = GeostatClient(language=args.language)
    if args.command == "catalog":
        print(json.dumps(client.catalog(args.path), ensure_ascii=False, indent=2))
    elif args.command == "metadata":
        print(json.dumps(client.metadata(args.table_path), ensure_ascii=False, indent=2))
    elif args.command == "fetch":
        csv_path, metadata_path = client.save(
            args.table_path, args.output, parse_selections(args.select)
        )
        print(f"Saved {csv_path}\nSaved {metadata_path}")
    elif args.command == "sync":
        names = list(load_registry()) if args.datasets == ["all"] else args.datasets
        for name in names:
            rows = sync_dataset(name, args.database, language=args.language)
            print(f"Synced {name}: {rows:,} rows -> {args.database}")
    elif args.command == "describe-db":
        print(database_overview(args.database))


if __name__ == "__main__":
    main()
