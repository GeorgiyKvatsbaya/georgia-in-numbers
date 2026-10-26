import { useMemo } from "react";
import { useI18n } from "../i18n";
import { useCatalog, type Catalog } from "./data";

/** English data value -> label in the current language, from catalog.json dimension values. */
export function buildLabelMap(catalog: Catalog | null, lang: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const entry of catalog?.objects ?? []) {
    for (const column of entry.columns) {
      for (const value of column.values ?? []) {
        if (!map.has(value.en)) map.set(value.en, value[lang as "en"] || value.en);
      }
    }
  }
  return map;
}

export function useLabels(): (value: unknown) => string {
  const { lang } = useI18n();
  const { data: catalog } = useCatalog();
  const map = useMemo(() => buildLabelMap(catalog, lang), [catalog, lang]);
  return (value: unknown) => {
    const text = String(value ?? "");
    return map.get(text) ?? text;
  };
}

/** Column header for a data column in the current language. */
export function useColumnLabels(): (column: string) => string {
  const { lang } = useI18n();
  const { data: catalog } = useCatalog();
  const map = useMemo(() => {
    const labels = new Map<string, string>();
    for (const entry of catalog?.objects ?? []) {
      for (const column of entry.columns) {
        if (!labels.has(column.name)) labels.set(column.name, column.label[lang] || column.name);
      }
    }
    return labels;
  }, [catalog, lang]);
  return (column: string) => {
    if (map.has(column)) return map.get(column)!;
    // Derived USD columns (e.g. exports_mln_usd) reuse the GEL label with the currency swapped.
    const gel = map.get(column.replace(/_usd$/, "_gel"));
    if (gel && column.endsWith("_usd")) return gel.replace(USD_SWAP[lang][0], USD_SWAP[lang][1]);
    return column;
  };
}

const USD_SWAP: Record<string, [RegExp, string]> = {
  en: [/GEL/, "USD"],
  ka: [/ლარი/, "აშშ დოლარი"],
  ru: [/лари/, "долл. США"],
};
