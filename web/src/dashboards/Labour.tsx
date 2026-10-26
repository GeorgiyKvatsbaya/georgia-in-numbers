import { useMemo } from "react";
import { ChartCard } from "../components/ChartCard";
import { FilterBar, inRange, RangeFilter, SelectFilter, useParamState, useRange } from "../components/Filters";
import { useI18n } from "../i18n";
import { rankedBarChart, timeSeriesChart, toSeries } from "../lib/charts";
import type { Dashboard, Row } from "../lib/data";
import { useColumnLabels, useLabels } from "../lib/labels";
import { DashboardPage, useRows } from "./shared";

const GROUPS = ["Total", "Female", "Male", "Urban", "Rural"];
const INDICATORS = ["unemployment_rate_pct", "participation_rate_pct", "employment_rate_pct"];

function LabourBody({ dashboard }: { dashboard: Dashboard }) {
  const { lang, t } = useI18n();
  const label = useLabels();
  const columnLabel = useColumnLabels();
  const { range, setRange, start } = useRange();
  const [group, setGroup] = useParamState("group", "Total");
  const [indicator, setIndicator] = useParamState("indicator", "unemployment_rate_pct");
  const [region, setRegion] = useParamState("region", "Tbilisi");
  const [yearParam, setYear] = useParamState("year", "");
  const headline = useRows(dashboard, "headline");
  const byRegion = useRows(dashboard, "by_region");

  const regions = useMemo(() => [...new Set(byRegion.map((row) => String(row.region)))].filter((name) => name !== "Georgia"), [byRegion]);
  const years = useMemo(
    () => [...new Set(byRegion.filter((row) => row[indicator] !== null).map((row) => String(row.year)))].sort().reverse(),
    [byRegion, indicator],
  );
  const year = years.includes(yearParam) ? yearParam : years[0];

  const charts = useMemo(() => {
    const pick = (groups: string[]) => inRange(headline.filter((row) => groups.includes(String(row.population_group))), start);
    const selected = pick([group]);
    const regionsYear = byRegion.filter((row) => String(row.year) === year);
    const trendRows = inRange(
      byRegion.filter((row) => row.region === region || row.region === "Georgia").map((row): Row => ({ ...row, period_start: `${row.year}-01-01` })),
      start,
    );
    return {
      sexRows: pick(["Total", "Female", "Male"]),
      sex: timeSeriesChart({ lang, period: "quarter", unit: "%", label, series: ["Total", "Female", "Male"].flatMap((g) => toSeries(pick([g]), "unemployment_rate_pct", "population_group")) }),
      areaRows: pick(["Urban", "Rural"]),
      area: timeSeriesChart({ lang, period: "quarter", unit: "%", label, series: ["Urban", "Rural"].flatMap((g) => toSeries(pick([g]), "unemployment_rate_pct", "population_group")) }),
      selected,
      rates: timeSeriesChart({
        lang, period: "quarter", unit: "%",
        series: [
          ...toSeries(selected, "participation_rate_pct", undefined, columnLabel("participation_rate_pct")),
          ...toSeries(selected, "employment_rate_pct", undefined, columnLabel("employment_rate_pct")),
        ],
      }),
      regionsYear,
      ranking: rankedBarChart({ lang, unit: "%", highlight: label("Georgia"), items: regionsYear.map((row) => ({ label: label(row.region), value: row[indicator] as number })) }),
      trendRows,
      trend: timeSeriesChart({
        lang, period: "annual", unit: "%", label,
        series: [region, "Georgia"].flatMap((name) => toSeries(trendRows.filter((row) => row.region === name), indicator, "region")),
      }),
    };
  }, [lang, label, columnLabel, headline, byRegion, group, indicator, region, year, start]);

  return (
    <>
      <FilterBar>
        <RangeFilter range={range} setRange={setRange} />
        <SelectFilter label={t("filters.populationGroup")} value={group} onChange={setGroup} options={GROUPS.map((value) => ({ value, label: label(value) }))} />
      </FilterBar>
      <div className="grid cols-2">
        <ChartCard wide title={t("labour.unempTitle")} subtitle={t("labour.unempSub")} info={t("info.unemp")} build={charts.sex} period="quarter"
          rows={charts.sexRows} columns={["population_group", "period_start", "unemployment_rate_pct"]} sources={["labour_quarterly"]} filename="unemployment" />
        <ChartCard title={t("labour.areaTitle")} subtitle={t("labour.unempSub")} info={t("info.unemp")} build={charts.area} period="quarter"
          rows={charts.areaRows} columns={["population_group", "period_start", "unemployment_rate_pct"]} sources={["labour_quarterly"]} filename="unemployment-urban-rural" />
        <ChartCard title={t("labour.ratesTitle")} subtitle={`${label(group)} · ${t("labour.ratesSub")}`} info={t("info.rates")} build={charts.rates} period="quarter"
          rows={charts.selected} columns={["population_group", "period_start", "participation_rate_pct", "employment_rate_pct", "employed_k", "unemployed_k"]}
          sources={["labour_quarterly"]} filename="participation-employment" />
      </div>
      <section className="section">
        <FilterBar>
          <SelectFilter label={t("filters.indicator")} value={indicator} onChange={setIndicator} options={INDICATORS.map((value) => ({ value, label: columnLabel(value) }))} />
          <SelectFilter label={t("filters.year")} value={year} onChange={setYear} options={years.map((value) => ({ value, label: value }))} />
          <SelectFilter label={t("filters.region")} value={region} onChange={setRegion} options={regions.map((value) => ({ value, label: label(value) }))} />
        </FilterBar>
        <div className="grid cols-2">
          <ChartCard tall title={`${columnLabel(indicator)} · ${year}`} subtitle={t("labour.regionTitle")} info={t("info.labourRegion")} build={charts.ranking}
            rows={charts.regionsYear} columns={["region", "year", "unemployment_rate_pct", "participation_rate_pct", "employment_rate_pct"]}
            sources={["labour_regional_annual"]} filename="labour-by-region" />
          <ChartCard tall title={t("labour.regionTrendTitle", { indicator: columnLabel(indicator), region: label(region) })} subtitle={t("filters.annual")}
            info={t("info.labourRegion")} build={charts.trend} period="annual" rows={charts.trendRows}
            columns={["region", "year", "unemployment_rate_pct", "participation_rate_pct", "employment_rate_pct"]}
            sources={["labour_regional_annual"]} filename="labour-region-trend" />
        </div>
      </section>
    </>
  );
}

export default function Labour() {
  return <DashboardPage topic="labour">{(dashboard) => <LabourBody dashboard={dashboard} />}</DashboardPage>;
}
