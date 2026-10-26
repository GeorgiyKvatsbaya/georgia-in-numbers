from __future__ import annotations

import argparse
import json
from pathlib import Path

from .checks import run_checks
from .client import GeostatClient
from .database import (
    DEFAULT_DATABASE,
    database_overview,
    dataset_age_days,
    load_registry,
    sync_dataset,
)
from .export import DEFAULT_OUTPUT, export


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
    sync.add_argument(
        "--force", action="store_true", help="Ignore max_age_days and refresh every dataset"
    )

    overview = subparsers.add_parser("describe-db", help="Print LLM-friendly database context")
    overview.add_argument("--database", type=Path, default=DEFAULT_DATABASE)

    check = subparsers.add_parser("check", help="Run data-quality gates against the last export")
    check.add_argument("--database", type=Path, default=DEFAULT_DATABASE)
    check.add_argument("--out", type=Path, default=DEFAULT_OUTPUT)
    check.add_argument(
        "--cross-source",
        action="store_true",
        help="Also compare GeoMap API figures with PXWeb (makes network requests)",
    )

    subparsers.add_parser(
        "boundaries", help="Download and simplify map boundaries into web/public/data/geo"
    )

    publish = subparsers.add_parser("export", help="Write Parquet, catalog and dashboard JSON")
    publish.add_argument("--database", type=Path, default=DEFAULT_DATABASE)
    publish.add_argument("--out", type=Path, default=DEFAULT_OUTPUT)
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
        registry = load_registry()
        sync_all = args.datasets == ["all"]
        names = list(registry) if sync_all else args.datasets
        failed = []
        for name in names:
            definition = registry.get(name, {})
            max_age = definition.get("max_age_days")
            age = dataset_age_days(name, args.database)
            if sync_all and not args.force and max_age and age is not None and age < max_age:
                print(f"Skipped {name}: synced {age:.0f} days ago (max_age_days={max_age})")
                continue
            try:
                rows = sync_dataset(name, args.database, language=args.language)
            except Exception as error:
                if not definition.get("tolerate_failure"):
                    raise
                # Fragile sources keep their previous table; the refresh carries on.
                failed.append(name)
                print(f"WARN {name}: sync failed, keeping previous data ({error})")
                continue
            print(f"Synced {name}: {rows:,} rows -> {args.database}")
        if failed:
            print(f"Finished with {len(failed)} tolerated failure(s): {', '.join(failed)}")
    elif args.command == "describe-db":
        print(database_overview(args.database))
    elif args.command == "check":
        failures = run_checks(
            args.database, args.out / "catalog.json", cross_source=args.cross_source
        )
        for failure in failures:
            print(f"FAIL {failure}")
        if failures:
            raise SystemExit(1)
        print("All checks passed")
    elif args.command == "boundaries":
        from .boundaries import build_boundaries  # shapely is only needed here

        for name, size in build_boundaries().items():
            print(f"Wrote {name}.json ({size / 1024:,.0f} KiB)")
    elif args.command == "export":
        catalog = export(args.database, args.out)
        size = sum(entry["bytes"] for entry in catalog["objects"])
        print(f"Exported {len(catalog['objects'])} objects ({size / 1024:,.0f} KiB) -> {args.out}")


if __name__ == "__main__":
    main()
