import { useMemo } from "react";
import { ChartCard } from "../components/ChartCard";
import { useI18n } from "../i18n";
import { rankedBarChart, timeSeriesChart, toSeries } from "../lib/charts";
import type { Dashboard } from "../lib/data";
import { useLabels } from "../lib/labels";
import { DashboardPage, useRows } from "./shared";

function LabourBody({ dashboard }: { dashboard: Dashboard }) {
  const { lang, t } = useI18n();
  const label = useLabels();
  const headline = useRows(dashboard, "headline");
  const byRegion = useRows(dashboard, "by_region");

  const charts = useMemo(() => {
    const pick = (groups: string[]) => headline.filter((row) => groups.includes(String(row.population_group)));
    const total = pick(["Total"]);
    const latestYear = Math.max(...byRegion.filter((row) => row.unemployment_rate_pct !== null).map((row) => Number(row.year)));
    const regions = byRegion.filter((row) => Number(row.year) === latestYear);
    return {
      sexRows: pick(["Total", "Female", "Male"]),
      sex: timeSeriesChart({ lang, period: "quarter", unit: "%", label, series: ["Total", "Female", "Male"].flatMap((g) => toSeries(pick([g]), "unemployment_rate_pct", "population_group")) }),
      areaRows: pick(["Urban", "Rural"]),
      area: timeSeriesChart({ lang, period: "quarter", unit: "%", label, series: ["Urban", "Rural"].flatMap((g) => toSeries(pick([g]), "unemployment_rate_pct", "population_group")) }),
      total,
      rates: timeSeriesChart({
        lang, period: "quarter", unit: "%",
        series: [
          ...toSeries(total, "participation_rate_pct", undefined, label("Labour force participation rate, percentage")),
          ...toSeries(total, "employment_rate_pct", undefined, label("Employment rate, percentage")),
        ],
      }),
      latestYear,
      regions,
      region: rankedBarChart({ lang, unit: "%", highlight: label("Georgia"), items: regions.map((row) => ({ label: label(row.region), value: row.unemployment_rate_pct as number })) }),
    };
  }, [lang, label, headline, byRegion]);

  return (
    <div className="grid cols-2">
      <ChartCard wide title={t("labour.unempTitle")} subtitle={t("labour.unempSub")} build={charts.sex} period="quarter"
        rows={charts.sexRows} columns={["population_group", "period_start", "unemployment_rate_pct"]} sources={["labour_quarterly"]} filename="unemployment" />
      <ChartCard title={t("labour.areaTitle")} subtitle={t("labour.unempSub")} build={charts.area} period="quarter"
        rows={charts.areaRows} columns={["population_group", "period_start", "unemployment_rate_pct"]} sources={["labour_quarterly"]} filename="unemployment-urban-rural" />
      <ChartCard title={t("labour.ratesTitle")} subtitle={t("labour.ratesSub")} build={charts.rates} period="quarter"
        rows={charts.total} columns={["period_start", "participation_rate_pct", "employment_rate_pct", "employed_k", "unemployed_k"]} sources={["labour_quarterly"]} filename="participation-employment" />
      <ChartCard tall wide title={t("labour.regionTitle")} subtitle={t("labour.regionSub", { year: String(charts.latestYear) })} build={charts.region}
        rows={charts.regions} columns={["region", "year", "unemployment_rate_pct", "participation_rate_pct", "employment_rate_pct"]} sources={["labour_regional_annual"]} filename="unemployment-by-region" />
    </div>
  );
}

export default function Labour() {
  return <DashboardPage topic="labour">{(dashboard) => <LabourBody dashboard={dashboard} />}</DashboardPage>;
}
