import { useEffect, useState } from "react";
import type { Lang } from "../i18n";

export type Localized = Record<Lang, string>;

export interface Column {
  name: string;
  type: string;
  role: "time" | "measure" | "dimension";
  label: Localized;
  values?: Localized[];
}

export interface Source {
  url: string;
  /** Human-facing Geostat PXWeb page (English); swap /en/ for /ka/ for Georgian. */
  web_url: string;
  path: string;
  retrieved_at: string;
}

export interface CatalogObject {
  name: string;
  kind: "table" | "view";
  dataset: string | null;
  topic: string;
  title: Localized;
  description: Localized & { en_detail?: string };
  unit: Localized | null;
  grain: string | null;
  requires?: string[];
  sources: Source[];
  columns: Column[];
  period_types: ("month" | "quarter" | "annual")[];
  row_count: number;
  value_count: number;
  first_period: string | null;
  last_period: string | null;
  file: string;
  bytes: number;
}

export interface Catalog {
  generated_at: string;
  source: { name: Localized; url: string };
  languages: Lang[];
  objects: CatalogObject[];
}

/** Columnar series as exported by `geostat export` (dashboards/<topic>.json). */
export interface SeriesTable {
  columns: string[];
  rows: unknown[][];
}

export interface Dashboard {
  topic: string;
  retrieved_at: string | null;
  series: Record<string, SeriesTable>;
}

export type Row = Record<string, unknown>;

export const DATA_BASE = "/data";

const cache = new Map<string, Promise<unknown>>();

export function fetchJson<T>(path: string): Promise<T> {
  if (!cache.has(path)) {
    const request = fetch(`${DATA_BASE}/${path}`).then((response) => {
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${path}`);
      return response.json();
    });
    // Drop failed requests so a later render can retry.
    request.catch(() => cache.delete(path));
    cache.set(path, request);
  }
  return cache.get(path) as Promise<T>;
}

export function toRows(table: SeriesTable | undefined): Row[] {
  if (!table) return [];
  return table.rows.map((values) =>
    Object.fromEntries(table.columns.map((column, index) => [column, values[index]])),
  );
}

interface Loadable<T> {
  data: T | null;
  error: Error | null;
}

export function useJson<T>(path: string | null): Loadable<T> {
  const [state, setState] = useState<Loadable<T>>({ data: null, error: null });
  useEffect(() => {
    if (!path) return;
    let active = true;
    setState({ data: null, error: null });
    fetchJson<T>(path).then(
      (data) => active && setState({ data, error: null }),
      (error: Error) => active && setState({ data: null, error }),
    );
    return () => {
      active = false;
    };
  }, [path]);
  return state;
}

export const useCatalog = () => useJson<Catalog>("catalog.json");
export const useDashboard = (topic: string) => useJson<Dashboard>(`dashboards/${topic}.json`);

/** Most recent retrieval date across all sources, for "data as of" notes. */
export function latestRetrieval(catalog: Catalog | null): string | null {
  if (!catalog) return null;
  const dates = catalog.objects.flatMap((entry) => entry.sources.map((s) => s.retrieved_at));
  return dates.length ? dates.sort().at(-1)! : null;
}
