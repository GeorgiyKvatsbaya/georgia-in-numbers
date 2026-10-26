import { useCallback, useMemo, useState } from "react";
import { ChartCard } from "../components/ChartCard";
import { MapChart } from "../components/MapChart";
import { useI18n } from "../i18n";
import { rankedBarChart } from "../lib/charts";
import type { Dashboard } from "../lib/data";
import { useLabels } from "../lib/labels";
import { DashboardPage, useRows } from "./shared";

type Level = "region" | "municipality";

const DEFAULT_INDICATOR = "Average monthly remuneration, GEL";

function RegionsBody({ dashboard }: { dashboard: Dashboard }) {
  const { lang, t } = useI18n();
  const label = useLabels();
  const rows = useRows(dashboard, "by_area");
  const indicators = useMemo(() => [...new Set(rows.map((row) => String(row.indicator)))], [rows]);
  const [indicator, setIndicator] = useState(DEFAULT_INDICATOR);
  const [level, setLevel] = useState<Level>("region");

  const levelRows = useMemo(
    () => rows.filter((row) => row.area_level === level && row.indicator === indicator),
    [rows, level, indicator],
  );
  const years = useMemo(() => [...new Set(levelRows.map((row) => Number(row.year)))].sort((a, b) => b - a), [levelRows]);
  const [yearChoice, setYear] = useState<number | null>(null);
  const year = yearChoice !== null && years.includes(yearChoice) ? yearChoice : years[0];
  const selected = useMemo(() => levelRows.filter((row) => Number(row.year) === year), [levelRows, year]);

  const values = useMemo(() => new Map(selected.map((row) => [String(row.area_code), Number(row.value)])), [selected]);
  const names = useMemo(() => new Map(selected.map((row) => [String(row.area_code), String(row.area)])), [selected]);
  const nameOf = useCallback(
    (id: string, feature: { name_en: string; name_ka: string }) =>
      names.has(id) ? label(names.get(id)) : lang === "ka" ? feature.name_ka : feature.name_en,
    [names, label, lang],
  );
  const digits = indicator.startsWith("Persons") || indicator === "Employees" ? 0 : 1;
  const ranking = useMemo(
    () => rankedBarChart({ lang, digits, items: selected.map((row) => ({ label: label(row.area), value: row.value as number })) }),
    [lang, digits, label, selected],
  );
  const levelName = level === "region" ? t("regions.levelRegions") : t("regions.levelMunicipalities");

  const controls = (
    <>
      <label className="small">
        <span className="muted">{t("regions.indicator")} </span>
        <select className="select" value={indicator} onChange={(event) => setIndicator(event.target.value)}>
          {indicators.map((name) => (
            <option key={name} value={name}>
              {label(name)}
            </option>
          ))}
        </select>
      </label>
      <div className="segmented" role="group" aria-label={t("regions.level")}>
        {(["region", "municipality"] as Level[]).map((value) => (
          <button key={value} type="button" className={value === level ? "active" : undefined} aria-pressed={value === level} onClick={() => setLevel(value)}>
            {value === "region" ? t("regions.levelRegions") : t("regions.levelMunicipalities")}
          </button>
        ))}
      </div>
      <label className="small">
        <span className="muted">{t("regions.year")} </span>
        <select className="select" value={year} onChange={(event) => setYear(Number(event.target.value))}>
          {years.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </label>
    </>
  );

  const columns = ["area", "area_code", "indicator", "year", "value"];
  return (
    <>
      <div className="filter-row">{controls}</div>
      <p className="notice" style={{ marginBottom: 16 }}>{t("regions.note")}</p>
      <div className="grid cols-2">
        <ChartCard title={label(indicator)} subtitle={t("regions.mapSub", { level: levelName, year: String(year) })}
          rows={selected} columns={columns} period="annual" sources={["business_by_area"]} filename="business-map">
          <MapChart layer={level === "region" ? "regions" : "municipalities"} values={values} nameOf={nameOf} label={label(indicator)} digits={digits} />
        </ChartCard>
        <ChartCard tall chartHeight={Math.max(420, selected.length * 22)} title={t("regions.rankingTitle")} subtitle={`${label(indicator)} · ${year}`} build={ranking}
          rows={selected} columns={columns} period="annual" sources={["business_by_area"]} filename="business-ranking" />
      </div>
    </>
  );
}

export default function Regions() {
  return <DashboardPage topic="regions">{(dashboard) => <RegionsBody dashboard={dashboard} />}</DashboardPage>;
}
