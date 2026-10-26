import { useCallback, useMemo } from "react";
import { ChartCard } from "../components/ChartCard";
import { FilterBar, Segmented, SelectFilter, useParamState } from "../components/Filters";
import { MapChart } from "../components/MapChart";
import { useI18n } from "../i18n";
import { columnChart, rankedBarChart } from "../lib/charts";
import type { Dashboard, Row } from "../lib/data";
import { useLabels } from "../lib/labels";
import { DashboardPage, useRows } from "./shared";

type Level = "region" | "municipality";

const DEFAULT_INDICATOR = "Average monthly remuneration, GEL";

function RegionsBody({ dashboard }: { dashboard: Dashboard }) {
  const { lang, t } = useI18n();
  const label = useLabels();
  const rows = useRows(dashboard, "by_area");
  const indicators = useMemo(() => [...new Set(rows.map((row) => String(row.indicator)))], [rows]);
  const [indicator, setIndicator] = useParamState("indicator", DEFAULT_INDICATOR);
  const [level, setLevel] = useParamState<Level>("level", "region");
  const [yearParam, setYear] = useParamState("year", "");
  const [areaParam, setArea] = useParamState("area", "11");

  const levelRows = useMemo(
    () => rows.filter((row) => row.area_level === level && row.indicator === indicator),
    [rows, level, indicator],
  );
  const years = useMemo(() => [...new Set(levelRows.map((row) => String(row.year)))].sort().reverse(), [levelRows]);
  const year = years.includes(yearParam) ? yearParam : years[0];
  const selected = useMemo(() => levelRows.filter((row) => String(row.year) === year), [levelRows, year]);
  const areas = useMemo(
    () => [...new Map(levelRows.map((row) => [String(row.area_code), String(row.area)]))].sort((a, b) => label(a[1]).localeCompare(label(b[1]), lang)),
    [levelRows, label, lang],
  );
  const area = areas.some(([code]) => code === areaParam) ? areaParam : areas[0]?.[0];
  const areaName = areas.find(([code]) => code === area)?.[1] ?? "";

  const values = useMemo(() => new Map(selected.map((row) => [String(row.area_code), Number(row.value)])), [selected]);
  const names = useMemo(() => new Map(selected.map((row) => [String(row.area_code), String(row.area)])), [selected]);
  const nameOf = useCallback(
    (id: string, feature: { name_en: string; name_ka: string }) =>
      names.has(id) ? label(names.get(id)) : lang === "ka" ? feature.name_ka : feature.name_en,
    [names, label, lang],
  );
  const digits = indicator.startsWith("Persons") || indicator === "Employees" ? 0 : 1;
  const ranking = useMemo(
    () => rankedBarChart({ lang, digits, highlight: label(areaName), items: selected.map((row) => ({ label: label(row.area), value: row.value as number })) }),
    [lang, digits, label, selected, areaName],
  );
  const trendRows = useMemo(
    () => levelRows.filter((row) => String(row.area_code) === area).map((row): Row => ({ ...row, period_start: `${row.year}-01-01` })),
    [levelRows, area],
  );
  const trend = useMemo(
    () => columnChart({ lang, period: "annual", digits, points: trendRows.map((row) => [String(row.period_start), row.value as number]) }),
    [lang, digits, trendRows],
  );
  const levelName = level === "region" ? t("regions.levelRegions") : t("regions.levelMunicipalities");
  const columns = ["area", "area_code", "indicator", "year", "value"];

  return (
    <>
      <FilterBar>
        <SelectFilter label={t("filters.indicator")} value={indicator} onChange={setIndicator} options={indicators.map((value) => ({ value, label: label(value) }))} />
        <Segmented label={t("regions.level")} value={level} onChange={setLevel}
          options={[{ value: "region", label: t("regions.levelRegions") }, { value: "municipality", label: t("regions.levelMunicipalities") }]} />
        <SelectFilter label={t("filters.year")} value={year} onChange={setYear} options={years.map((value) => ({ value, label: value }))} />
        <SelectFilter label={t("filters.area")} value={area ?? ""} onChange={setArea} options={areas.map(([value, name]) => ({ value, label: label(name) }))} />
      </FilterBar>
      <p className="notice" style={{ marginBottom: 16 }}>{t("regions.note")}</p>
      <div className="grid cols-2">
        <ChartCard title={label(indicator)} subtitle={t("regions.mapSub", { level: levelName, year })} info={t("info.map")}
          rows={selected} columns={columns} period="annual" sources={["business_by_area"]} filename="business-map">
          <MapChart layer={level === "region" ? "regions" : "municipalities"} values={values} nameOf={nameOf} label={label(indicator)} digits={digits} />
        </ChartCard>
        <ChartCard tall chartHeight={Math.max(420, selected.length * 22)} title={t("regions.rankingTitle")} subtitle={`${label(indicator)} · ${year}`}
          info={t("info.map")} build={ranking} rows={selected} columns={columns} period="annual" sources={["business_by_area"]} filename="business-ranking" />
        <ChartCard wide title={t("regions.trendTitle", { indicator: label(indicator), area: label(areaName) })} subtitle={levelName} info={t("info.areaTrend")}
          build={trend} rows={trendRows} columns={columns} period="annual" sources={["business_by_area"]} filename="business-area-trend" />
      </div>
    </>
  );
}

export default function Regions() {
  return <DashboardPage topic="regions">{(dashboard) => <RegionsBody dashboard={dashboard} />}</DashboardPage>;
}
