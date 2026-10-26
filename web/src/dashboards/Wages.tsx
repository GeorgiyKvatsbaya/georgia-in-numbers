import { useMemo } from "react";
import { ChartCard } from "../components/ChartCard";
import { FilterBar, inRange, RangeFilter, SelectFilter, useParamState, useRange } from "../components/Filters";
import { useI18n } from "../i18n";
import { columnChart, latestBy, rankedBarChart, timeSeriesChart, toSeries } from "../lib/charts";
import type { Dashboard } from "../lib/data";
import { formatPeriod } from "../lib/format";
import { useLabels } from "../lib/labels";
import { DashboardPage, maxPeriod, useRows } from "./shared";

function WagesBody({ dashboard }: { dashboard: Dashboard }) {
  const { lang, t } = useI18n();
  const label = useLabels();
  const { range, setRange, start } = useRange();
  const [group, setGroup] = useParamState("group", "Total in country");
  const [activity, setActivity] = useParamState("activity", "Total");
  const history = useRows(dashboard, "history");
  const byRegion = useRows(dashboard, "by_region");

  const groups = useMemo(() => [...new Set(history.map((row) => String(row.sex_sectors)))], [history]);
  // Only activities with quarterly data for the chosen group (sector breakdowns are sparse).
  const activities = useMemo(
    () => [...new Set(history.filter((row) => row.sex_sectors === group && row.nominal_salary_gel !== null).map((row) => String(row.economic_activity)))],
    [history, group],
  );
  const activeActivity = activities.includes(activity) ? activity : "Total";

  const charts = useMemo(() => {
    const series = inRange(history.filter((row) => row.sex_sectors === group && row.economic_activity === activeActivity && row.nominal_salary_gel !== null), start);
    const byActivity = latestBy(history.filter((row) => row.sex_sectors === group && row.economic_activity !== "Total" && row.nominal_salary_gel !== null));
    const bySex = inRange(history.filter((row) => (row.sex_sectors === "Female" || row.sex_sectors === "Male") && row.economic_activity === activeActivity && row.nominal_salary_gel !== null), start);
    return {
      series,
      salary: timeSeriesChart({
        lang, period: "quarter", digits: 0, unit: " ₾",
        series: [
          ...toSeries(series, "nominal_salary_gel", undefined, t("wages.nominal")),
          ...toSeries(series, "real_salary_gel_2010", undefined, t("wages.real")),
        ],
      }),
      growth: columnChart({
        lang, period: "quarter", unit: "%",
        points: series.filter((row) => row.real_yoy_pct !== null).map((row) => [String(row.period_start), row.real_yoy_pct as number]),
      }),
      byActivity,
      activityChart: rankedBarChart({ lang, digits: 0, highlight: label(activeActivity), items: byActivity.map((row) => ({ label: label(row.economic_activity), value: row.nominal_salary_gel as number })) }),
      bySex,
      sex: timeSeriesChart({ lang, period: "quarter", digits: 0, unit: " ₾", label, series: toSeries(bySex, "nominal_salary_gel", "sex_sectors") }),
      region: rankedBarChart({ lang, digits: 0, highlight: label("Total"), items: byRegion.map((row) => ({ label: label(row.region), value: row.nominal_salary_gel as number })) }),
    };
  }, [lang, t, label, history, byRegion, group, activeActivity, start]);

  const columns = ["sex_sectors", "economic_activity", "period_start", "nominal_salary_gel", "real_salary_gel_2010", "real_wage_index_2014", "nominal_yoy_pct", "real_yoy_pct"];
  return (
    <>
      <FilterBar>
        <RangeFilter range={range} setRange={setRange} />
        <SelectFilter label={t("filters.sexSector")} value={group} onChange={setGroup} options={groups.map((value) => ({ value, label: label(value) }))} />
        <SelectFilter label={t("filters.activity")} value={activeActivity} onChange={setActivity} options={activities.map((value) => ({ value, label: label(value) }))} />
      </FilterBar>
      <div className="grid cols-2">
        <ChartCard wide title={t("wages.salaryTitle")} subtitle={t("wages.salarySub", { group: label(group), activity: label(activeActivity) })}
          info={t("info.salary")} build={charts.salary} period="quarter" rows={charts.series} columns={columns}
          sources={["real_wages_quarterly"]} filename="wages" />
        <ChartCard title={t("wages.realGrowthTitle")} subtitle={t("wages.realGrowthSub")} info={t("info.realGrowth")} build={charts.growth} period="quarter"
          rows={charts.series} columns={["period_start", "nominal_yoy_pct", "real_yoy_pct"]} sources={["real_wages_quarterly"]} filename="real-wage-growth" />
        <ChartCard title={t("wages.sexTitle")} subtitle={`${label(activeActivity)} · ${t("wages.sexSub")}`} info={t("info.sex")} build={charts.sex} period="quarter"
          rows={charts.bySex} columns={["sex_sectors", "period_start", "nominal_salary_gel"]} sources={["salaries_quarterly"]} filename="wages-by-sex" />
        <ChartCard tall chartHeight={Math.max(420, charts.byActivity.length * 24)} title={t("wages.activityTitle")}
          subtitle={`${label(group)} · ${t("wages.perMonth", { period: formatPeriod(lang, maxPeriod(charts.byActivity), "quarter") })}`}
          info={t("info.activity")} build={charts.activityChart} period="quarter" rows={charts.byActivity}
          columns={["economic_activity", "period_start", "nominal_salary_gel", "real_yoy_pct"]} sources={["salaries_quarterly"]} filename="wages-by-activity" />
        <ChartCard tall title={t("wages.regionTitle")} subtitle={t("wages.perMonth", { period: formatPeriod(lang, maxPeriod(byRegion), "quarter") })}
          info={t("info.wageRegion")} build={charts.region} period="quarter" rows={byRegion} columns={["region", "period_start", "nominal_salary_gel"]}
          sources={["salaries_regional"]} filename="wages-by-region" />
      </div>
    </>
  );
}

export default function Wages() {
  return <DashboardPage topic="wages">{(dashboard) => <WagesBody dashboard={dashboard} />}</DashboardPage>;
}
