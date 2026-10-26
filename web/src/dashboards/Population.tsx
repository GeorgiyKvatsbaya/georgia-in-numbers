import { useMemo } from "react";
import { baseOption, categoryAxis, valueAxis, type ChartTheme } from "../components/Chart";
import { ChartCard } from "../components/ChartCard";
import { useI18n, type Lang } from "../i18n";
import { rankedBarChart, timeSeriesChart, toSeries } from "../lib/charts";
import type { Dashboard, Row } from "../lib/data";
import { formatNumber } from "../lib/format";
import { useLabels } from "../lib/labels";
import { DashboardPage, useRows } from "./shared";

const AGE_ORDER = ["0", "1-4", "5-9", "10-14", "15-19", "20-24", "25-29", "30-34", "35-39", "40-44", "45-49", "50-54", "55-59", "60-64", "65-69", "70-74", "75-79", "80-84", "85+"];

/** Population pyramid: men to the left, women to the right, one shared axis. */
function pyramidChart(lang: Lang, rows: Row[], label: (value: unknown) => string) {
  const value = (sex: string, age: string) =>
    Number(rows.find((row) => row.sex === sex && row.age === age)?.population_k ?? 0);
  const format = (v: unknown) => formatNumber(lang, Math.abs(Number(v)), { digits: 1 });
  return (theme: ChartTheme) => ({
    ...baseOption(theme, 2),
    tooltip: { ...(baseOption(theme, 2).tooltip as object), trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: format },
    grid: { left: 8, right: 16, top: 36, bottom: 8, containLabel: true },
    xAxis: valueAxis(theme, (v: number) => formatNumber(lang, Math.abs(v), { digits: 0 })),
    yAxis: { ...categoryAxis(theme, AGE_ORDER), axisLabel: { color: theme.muted } },
    series: [
      { type: "bar", name: label("Males"), stack: "pyramid", barMaxWidth: 24, itemStyle: { color: theme.series[0], borderRadius: [4, 0, 0, 4] }, data: AGE_ORDER.map((age) => -value("Males", age)) },
      { type: "bar", name: label("Females"), stack: "pyramid", barMaxWidth: 24, itemStyle: { color: theme.series[1], borderRadius: [0, 4, 4, 0] }, data: AGE_ORDER.map((age) => value("Females", age)) },
    ],
  });
}

function PopulationBody({ dashboard }: { dashboard: Dashboard }) {
  const { lang, t } = useI18n();
  const label = useLabels();
  const total = useRows(dashboard, "total");
  const byRegion = useRows(dashboard, "by_region");
  const pyramid = useRows(dashboard, "pyramid");
  const poverty = useRows(dashboard, "poverty");

  const charts = useMemo(() => {
    const latestYear = Math.max(...byRegion.map((row) => Number(row.year)));
    const regionsLatest = byRegion.filter((row) => Number(row.year) === latestYear);
    const pyramidYear = Math.max(...pyramid.map((row) => Number(row.year)));
    const withStart = (rows: Row[]) => rows.map((row) => ({ ...row, period_start: `${row.year}-01-01` }));
    const groups = ["Georgia", "Urban", "Rural"];
    return {
      total: timeSeriesChart({ lang, period: "annual", digits: 1, area: true, series: toSeries(withStart(total), "population_k") }),
      latestYear,
      regionsLatest,
      regions: rankedBarChart({ lang, digits: 1, items: regionsLatest.map((row) => ({ label: label(row.region), value: row.population_k as number })) }),
      pyramidYear,
      pyramid: pyramidChart(lang, pyramid.filter((row) => Number(row.year) === pyramidYear), label),
      poverty: timeSeriesChart({
        lang, period: "annual", unit: "%", label,
        series: groups.flatMap((group) => toSeries(withStart(poverty.filter((row) => row.population_group === group)), "poverty_rate_pct", "population_group")),
      }),
    };
  }, [lang, label, total, byRegion, pyramid, poverty]);

  return (
    <div className="grid cols-2">
      <ChartCard title={t("population.totalTitle")} subtitle={t("population.totalSub")} build={charts.total} period="annual"
        rows={total} columns={["year", "population_k"]} sources={["population_by_area"]} filename="population" />
      <ChartCard title={t("population.povertyTitle")} subtitle={t("population.povertySub")} build={charts.poverty} period="annual"
        rows={poverty} columns={["population_group", "year", "poverty_rate_pct"]} sources={["poverty_absolute"]} filename="poverty" />
      <ChartCard tall title={t("population.pyramidTitle")} subtitle={t("population.thousand", { year: String(charts.pyramidYear) })} build={charts.pyramid} period="annual"
        rows={pyramid} columns={["year", "sex", "age", "population_k"]} sources={["population_age_sex"]} filename="population-age-sex" />
      <ChartCard tall title={t("population.regionsTitle")} subtitle={t("population.thousand", { year: String(charts.latestYear) })} build={charts.regions} period="annual"
        rows={byRegion} columns={["region", "year", "population_k"]} sources={["population_by_area"]} filename="population-by-region" />
    </div>
  );
}

export default function Population() {
  return <DashboardPage topic="population">{(dashboard) => <PopulationBody dashboard={dashboard} />}</DashboardPage>;
}
