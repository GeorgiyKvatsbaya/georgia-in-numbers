import { useMemo } from "react";
import { ChartCard } from "../components/ChartCard";
import { useI18n } from "../i18n";
import { columnChart, rankedBarChart, timeSeriesChart, toSeries } from "../lib/charts";
import type { Dashboard } from "../lib/data";
import { useLabels } from "../lib/labels";
import { DashboardPage, useRows } from "./shared";

const yearStart = (year: unknown) => `${year}-01-01`;

function EconomyBody({ dashboard }: { dashboard: Dashboard }) {
  const { lang, t } = useI18n();
  const label = useLabels();
  const quarterly = useRows(dashboard, "quarterly");
  const annual = useRows(dashboard, "annual");
  const byActivity = useRows(dashboard, "by_activity");
  const fdi = useRows(dashboard, "fdi");

  const charts = useMemo(() => {
    const preliminary = new Set(quarterly.filter((row) => row.is_preliminary).map((row) => String(row.period_start)));
    const annualPreliminary = new Set(annual.filter((row) => row.is_preliminary).map((row) => yearStart(row.year)));
    const fdiAnnual = fdi.filter((row) => row.period_type === "annual");
    return {
      growth: columnChart({
        lang, period: "quarter", unit: "%", muted: (date) => preliminary.has(date),
        points: quarterly.filter((row) => row.real_growth_pct !== null && String(row.period_start) >= "2015").map((row) => [String(row.period_start), row.real_growth_pct as number]),
      }),
      perCapita: columnChart({
        lang, period: "annual", digits: 0, unit: " $", muted: (date) => annualPreliminary.has(date),
        points: annual.map((row) => [yearStart(row.year), row.gdp_per_capita_usd as number]),
      }),
      sectors: rankedBarChart({ lang, items: byActivity.map((row) => ({ label: label(row.activity), value: row.share_of_gva_pct as number })) }),
      sectorYear: byActivity[0]?.year,
      fdiAnnual,
      fdi: columnChart({ lang, period: "annual", digits: 0, points: fdiAnnual.map((row) => [String(row.period_start), row.fdi_mln_usd as number]) }),
      fx: timeSeriesChart({ lang, period: "quarter", digits: 3, series: toSeries(quarterly, "gel_per_usd") }),
    };
  }, [lang, label, quarterly, annual, byActivity, fdi]);

  return (
    <div className="grid cols-2">
      <ChartCard wide title={t("economy.growthTitle")} subtitle={t("economy.growthSub")} build={charts.growth} period="quarter"
        rows={quarterly} columns={["period_start", "is_preliminary", "real_growth_pct", "gdp_mln_gel", "gdp_mln_usd", "deflator_pct"]}
        sources={["gdp_headline"]} filename="gdp-growth" />
      <ChartCard title={t("economy.perCapitaTitle")} subtitle={t("economy.perCapitaSub")} build={charts.perCapita} period="annual"
        rows={annual} columns={["year", "is_preliminary", "gdp_per_capita_usd", "gdp_per_capita_gel", "gdp_mln_gel", "real_growth_pct"]}
        sources={["gdp_headline"]} filename="gdp-per-capita" />
      <ChartCard title={t("economy.fxTitle")} subtitle={t("economy.fxSub")} build={charts.fx} period="quarter"
        rows={quarterly} columns={["period_start", "gel_per_usd"]} sources={["gdp_headline"]} filename="exchange-rate" />
      <ChartCard tall title={t("economy.sectorsTitle")} subtitle={t("economy.sectorsSub", { year: String(charts.sectorYear ?? "") })} build={charts.sectors}
        rows={byActivity} columns={["nace_section", "activity", "year", "gva_mln_gel", "share_of_gva_pct", "real_growth_pct"]}
        sources={["gdp_by_activity"]} filename="gdp-by-activity" />
      <ChartCard title={t("economy.fdiTitle")} subtitle={t("economy.fdiSub")} build={charts.fdi} period="annual"
        rows={charts.fdiAnnual} columns={["year", "fdi_mln_usd"]} sources={["fdi_quarterly"]} filename="fdi" />
    </div>
  );
}

export default function Economy() {
  return <DashboardPage topic="economy">{(dashboard) => <EconomyBody dashboard={dashboard} />}</DashboardPage>;
}
