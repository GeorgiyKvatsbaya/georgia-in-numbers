import { useMemo } from "react";
import { ChartCard } from "../components/ChartCard";
import { FilterBar, inRange, RangeFilter, Segmented, SelectFilter, useParamState, useRange } from "../components/Filters";
import { useI18n } from "../i18n";
import { columnChart, rankedBarChart, timeSeriesChart, toSeries } from "../lib/charts";
import type { Dashboard, Row } from "../lib/data";
import { useLabels } from "../lib/labels";
import { DashboardPage, useRows } from "./shared";

type Frequency = "quarter" | "annual";
const yearStart = (year: unknown) => `${year}-01-01`;

function EconomyBody({ dashboard }: { dashboard: Dashboard }) {
  const { lang, t } = useI18n();
  const label = useLabels();
  const { range, setRange, start } = useRange();
  const [frequency, setFrequency] = useParamState<Frequency>("freq", "quarter");
  const [sector, setSector] = useParamState("sector", "C");
  const quarterly = useRows(dashboard, "quarterly");
  const annual = useRows(dashboard, "annual");
  const byActivity = useRows(dashboard, "by_activity");
  const sectorGrowth = useRows(dashboard, "sector_growth");
  const fdi = useRows(dashboard, "fdi");
  const sectorNames = useMemo(() => new Map(byActivity.map((row) => [String(row.nace_section), String(row.activity)])), [byActivity]);

  const charts = useMemo(() => {
    const periodRows: Row[] = frequency === "quarter" ? quarterly : annual.map((row) => ({ ...row, period_start: yearStart(row.year) }));
    const growthRows = inRange(periodRows.filter((row) => row.real_growth_pct !== null), start);
    const preliminary = new Set(growthRows.filter((row) => row.is_preliminary).map((row) => String(row.period_start)));
    const perCapitaRows = inRange(annual.map((row): Row => ({ ...row, period_start: yearStart(row.year) })), start);
    const annualPreliminary = new Set(perCapitaRows.filter((row) => row.is_preliminary).map((row) => String(row.period_start)));
    const fdiAnnual = inRange(fdi.filter((row) => row.period_type === "annual"), start);
    const sectorRows = inRange(sectorGrowth.filter((row) => row.nace_section === sector && row.period_type === frequency), start);
    const sectorPreliminary = new Set(sectorRows.filter((row) => row.is_preliminary).map((row) => String(row.period_start)));
    const fxRows = inRange(quarterly, start);
    return {
      growthRows,
      growth: columnChart({ lang, period: frequency, unit: "%", muted: (date) => preliminary.has(date), points: growthRows.map((row) => [String(row.period_start), row.real_growth_pct as number]) }),
      perCapitaRows,
      perCapita: columnChart({ lang, period: "annual", digits: 0, unit: " $", muted: (date) => annualPreliminary.has(date), points: perCapitaRows.map((row) => [String(row.period_start), row.gdp_per_capita_usd as number]) }),
      sectors: rankedBarChart({ lang, highlight: label(sectorNames.get(sector)), items: byActivity.map((row) => ({ label: label(row.activity), value: row.share_of_gva_pct as number })) }),
      sectorYear: byActivity[0]?.year,
      sectorRows,
      sectorChart: columnChart({ lang, period: frequency, unit: "%", muted: (date) => sectorPreliminary.has(date), points: sectorRows.map((row) => [String(row.period_start), row.real_growth_pct as number]) }),
      fdiAnnual,
      fdi: columnChart({ lang, period: "annual", digits: 0, points: fdiAnnual.map((row) => [String(row.period_start), row.fdi_mln_usd as number]) }),
      fxRows,
      fx: timeSeriesChart({ lang, period: "quarter", digits: 3, series: toSeries(fxRows, "gel_per_usd") }),
    };
  }, [lang, label, quarterly, annual, byActivity, sectorGrowth, fdi, frequency, sector, sectorNames, start]);

  const sectorOptions = [...sectorNames].map(([value, name]) => ({ value, label: `${value} · ${label(name)}` }));
  return (
    <>
      <FilterBar>
        <RangeFilter range={range} setRange={setRange} />
        <Segmented label={t("filters.frequency")} value={frequency} onChange={setFrequency}
          options={[{ value: "quarter", label: t("filters.quarterly") }, { value: "annual", label: t("filters.annual") }]} />
      </FilterBar>
      <div className="grid cols-2">
        <ChartCard wide title={t("economy.growthTitle")} subtitle={frequency === "quarter" ? t("economy.growthSub") : t("economy.growthSubAnnual")}
          info={t("info.growth")} build={charts.growth} period={frequency} rows={charts.growthRows}
          columns={["period_start", "is_preliminary", "real_growth_pct", "gdp_mln_gel", "gdp_mln_usd", "deflator_pct"]}
          sources={["gdp_headline"]} filename="gdp-growth" />
        <ChartCard title={t("economy.sectorGrowthTitle")} subtitle={`${label(sectorNames.get(sector))} · ${frequency === "quarter" ? t("economy.growthSub") : t("economy.growthSubAnnual")}`}
          info={t("info.sectorGrowth")} controls={<SelectFilter label={t("filters.sector")} value={sector} onChange={setSector} options={sectorOptions} />}
          build={charts.sectorChart} period={frequency} rows={charts.sectorRows} columns={["nace_section", "period_start", "is_preliminary", "real_growth_pct"]}
          sources={["gdp_by_activity"]} filename="sector-growth" />
        <ChartCard tall title={t("economy.sectorsTitle")} subtitle={t("economy.sectorsSub", { year: String(charts.sectorYear ?? "") })} info={t("info.sectors")}
          build={charts.sectors} rows={byActivity} columns={["nace_section", "activity", "year", "gva_mln_gel", "share_of_gva_pct", "real_growth_pct"]}
          sources={["gdp_by_activity"]} filename="gdp-by-activity" />
        <ChartCard title={t("economy.perCapitaTitle")} subtitle={t("economy.perCapitaSub")} info={t("info.perCapita")} build={charts.perCapita} period="annual"
          rows={charts.perCapitaRows} columns={["year", "is_preliminary", "gdp_per_capita_usd", "gdp_per_capita_gel", "gdp_mln_gel", "real_growth_pct"]}
          sources={["gdp_headline"]} filename="gdp-per-capita" />
        <ChartCard title={t("economy.fxTitle")} subtitle={t("economy.fxSub")} info={t("info.fx")} build={charts.fx} period="quarter"
          rows={charts.fxRows} columns={["period_start", "gel_per_usd"]} sources={["gdp_headline"]} filename="exchange-rate" />
        <ChartCard title={t("economy.fdiTitle")} subtitle={t("economy.fdiSub")} info={t("info.fdi")} build={charts.fdi} period="annual"
          rows={charts.fdiAnnual} columns={["year", "fdi_mln_usd"]} sources={["fdi_quarterly"]} filename="fdi" />
      </div>
    </>
  );
}

export default function Economy() {
  return <DashboardPage topic="economy">{(dashboard) => <EconomyBody dashboard={dashboard} />}</DashboardPage>;
}
