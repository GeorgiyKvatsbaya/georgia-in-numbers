import { useMemo } from "react";
import { ChartCard } from "../components/ChartCard";
import { useI18n } from "../i18n";
import { columnChart, rankedBarChart, timeSeriesChart, toSeries } from "../lib/charts";
import type { Dashboard } from "../lib/data";
import { formatPeriod } from "../lib/format";
import { useLabels } from "../lib/labels";
import { DashboardPage, maxPeriod, useRows } from "./shared";

function WagesBody({ dashboard }: { dashboard: Dashboard }) {
  const { lang, t } = useI18n();
  const label = useLabels();
  const headline = useRows(dashboard, "headline");
  const byActivity = useRows(dashboard, "by_activity");
  const bySex = useRows(dashboard, "by_sex");
  const byRegion = useRows(dashboard, "by_region");

  const charts = useMemo(() => {
    const nominal = t("wages.nominal");
    const real = t("wages.real");
    return {
      salary: timeSeriesChart({
        lang, period: "quarter", digits: 0, unit: " ₾",
        series: [
          ...toSeries(headline, "nominal_salary_gel", undefined, nominal),
          ...toSeries(headline, "real_salary_gel_2010", undefined, real),
        ],
      }),
      growth: columnChart({
        lang, period: "quarter", unit: "%",
        points: headline.filter((row) => row.real_yoy_pct !== null).map((row) => [String(row.period_start), row.real_yoy_pct as number]),
      }),
      activity: rankedBarChart({ lang, digits: 0, items: byActivity.map((row) => ({ label: label(row.economic_activity), value: row.nominal_salary_gel as number })) }),
      sex: timeSeriesChart({ lang, period: "quarter", digits: 0, unit: " ₾", label, series: toSeries(bySex, "nominal_salary_gel", "sex") }),
      region: rankedBarChart({ lang, digits: 0, highlight: label("Total"), items: byRegion.map((row) => ({ label: label(row.region), value: row.nominal_salary_gel as number })) }),
    };
  }, [lang, t, label, headline, byActivity, bySex, byRegion]);

  return (
    <div className="grid cols-2">
      <ChartCard wide title={t("wages.salaryTitle")} subtitle={t("wages.salarySub")} build={charts.salary} period="quarter"
        rows={headline} columns={["period_start", "nominal_salary_gel", "real_salary_gel_2010", "real_wage_index_2014", "nominal_yoy_pct", "cpi_yoy_pct", "real_yoy_pct"]}
        sources={["real_wages_quarterly"]} filename="wages" />
      <ChartCard title={t("wages.realGrowthTitle")} subtitle={t("wages.realGrowthSub")} build={charts.growth} period="quarter"
        rows={headline} columns={["period_start", "real_yoy_pct"]} sources={["real_wages_quarterly"]} filename="real-wage-growth" />
      <ChartCard title={t("wages.sexTitle")} subtitle={t("wages.sexSub")} build={charts.sex} period="quarter"
        rows={bySex} columns={["sex", "period_start", "nominal_salary_gel"]} sources={["salaries_quarterly"]} filename="wages-by-sex" />
      <ChartCard tall title={t("wages.activityTitle")} subtitle={t("wages.perMonth", { period: formatPeriod(lang, maxPeriod(byActivity), "quarter") })}
        build={charts.activity} period="quarter" rows={byActivity} columns={["economic_activity", "period_start", "nominal_salary_gel", "real_yoy_pct"]}
        sources={["salaries_quarterly"]} filename="wages-by-activity" />
      <ChartCard tall title={t("wages.regionTitle")} subtitle={t("wages.perMonth", { period: formatPeriod(lang, maxPeriod(byRegion), "quarter") })}
        build={charts.region} period="quarter" rows={byRegion} columns={["region", "period_start", "nominal_salary_gel"]}
        sources={["salaries_regional"]} filename="wages-by-region" />
    </div>
  );
}

export default function Wages() {
  return <DashboardPage topic="wages">{(dashboard) => <WagesBody dashboard={dashboard} />}</DashboardPage>;
}
