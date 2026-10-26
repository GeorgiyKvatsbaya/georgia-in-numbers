import { useMemo } from "react";
import { ChartCard } from "../components/ChartCard";
import { FilterBar, inRange, RangeFilter, Segmented, useParamState, useRange } from "../components/Filters";
import { useI18n } from "../i18n";
import { columnChart, timeSeriesChart, toSeries } from "../lib/charts";
import type { Dashboard, Row } from "../lib/data";
import { DashboardPage, useRows } from "./shared";

type Frequency = "quarter" | "annual";
type Currency = "GEL" | "USD";
const MONEY = ["exports_mln_gel", "imports_mln_gel", "net_exports_mln_gel", "exports_goods_mln_gel", "exports_services_mln_gel"];

/** Column name of a money column in the chosen currency ("exports_mln_gel" -> "exports_mln_usd"). */
const col = (column: string, currency: Currency) => (currency === "USD" ? column.replace(/_gel$/, "_usd") : column);

/** Convert GEL columns to USD at each period's average exchange rate (from the same source). */
function inCurrency(rows: Row[], currency: Currency): Row[] {
  if (currency === "GEL") return rows;
  return rows.map((row) => {
    const rate = Number(row.gel_per_usd);
    const converted: Row = { ...row };
    for (const column of MONEY) {
      const value = row[column];
      delete converted[column];
      converted[col(column, currency)] = value === null || value === undefined || !rate ? null : Math.round((Number(value) / rate) * 10) / 10;
    }
    return converted;
  });
}

function TradeBody({ dashboard }: { dashboard: Dashboard }) {
  const { lang, t } = useI18n();
  const { range, setRange, start } = useRange();
  const [frequency, setFrequency] = useParamState<Frequency>("freq", "quarter");
  const [currency, setCurrency] = useParamState<Currency>("currency", "GEL");
  const quarterly = useRows(dashboard, "quarterly");
  const annual = useRows(dashboard, "annual");

  const charts = useMemo(() => {
    const annualRows = annual.map((row): Row => ({ ...row, period_start: `${row.year}-01-01` }));
    const rows = inRange(inCurrency(frequency === "quarter" ? quarterly : annualRows, currency), start);
    const preliminary = new Set(rows.filter((row) => row.is_preliminary).map((row) => String(row.period_start)));
    const shares = inRange(annualRows, start);
    return {
      rows,
      shares,
      flows: timeSeriesChart({
        lang, period: frequency, digits: 0,
        series: [...toSeries(rows, col("exports_mln_gel", currency), undefined, t("trade.exports")), ...toSeries(rows, col("imports_mln_gel", currency), undefined, t("trade.imports"))],
      }),
      balance: columnChart({ lang, period: frequency, digits: 0, muted: (date) => preliminary.has(date), points: rows.map((row) => [String(row.period_start), row[col("net_exports_mln_gel", currency)] as number]) }),
      composition: timeSeriesChart({
        lang, period: frequency, digits: 0,
        series: [...toSeries(rows, col("exports_goods_mln_gel", currency), undefined, t("trade.goods")), ...toSeries(rows, col("exports_services_mln_gel", currency), undefined, t("trade.services"))],
      }),
      open: timeSeriesChart({
        lang, period: "annual", unit: "%",
        series: [...toSeries(shares, "exports_share_of_gdp_pct", undefined, t("trade.exports")), ...toSeries(shares, "imports_share_of_gdp_pct", undefined, t("trade.imports"))],
      }),
    };
  }, [lang, t, quarterly, annual, frequency, currency, start]);

  const money = t("trade.flowsSubCurrency", { currency: currency === "GEL" ? "GEL" : "USD" });
  const columns = ["period_start", ...MONEY.map((column) => col(column, currency)), "gel_per_usd", "is_preliminary"];
  return (
    <>
      <p className="notice" style={{ marginBottom: 16 }}>{t("trade.note")}</p>
      <FilterBar>
        <RangeFilter range={range} setRange={setRange} />
        <Segmented label={t("filters.frequency")} value={frequency} onChange={setFrequency}
          options={[{ value: "quarter", label: t("filters.quarterly") }, { value: "annual", label: t("filters.annual") }]} />
        <Segmented label={t("filters.currency")} value={currency} onChange={setCurrency}
          options={[{ value: "GEL", label: "₾ GEL" }, { value: "USD", label: "$ USD" }]} />
      </FilterBar>
      <div className="grid cols-2">
        <ChartCard wide title={t("trade.flowsTitle")} subtitle={money} info={t("info.flows")} build={charts.flows} period={frequency}
          rows={charts.rows} columns={columns} sources={["gdp_headline"]} filename={`exports-imports-${currency.toLowerCase()}`} />
        <ChartCard title={t("trade.balanceTitle")} subtitle={t("trade.balanceSubCurrency", { currency })} info={t("info.balance")} build={charts.balance} period={frequency}
          rows={charts.rows} columns={["period_start", col("net_exports_mln_gel", currency)]} sources={["gdp_headline"]} filename="trade-balance" />
        <ChartCard title={t("trade.compositionTitle")} subtitle={money} info={t("info.composition")} build={charts.composition} period={frequency}
          rows={charts.rows} columns={columns} sources={["gdp_headline"]} filename="exports-goods-services" />
        <ChartCard wide title={t("trade.openTitle")} subtitle={t("trade.openSub")} info={t("info.open")} build={charts.open} period="annual"
          rows={charts.shares} columns={["year", "exports_mln_gel", "imports_mln_gel", "exports_share_of_gdp_pct", "imports_share_of_gdp_pct"]}
          sources={["gdp_headline"]} filename="trade-share-of-gdp" />
      </div>
    </>
  );
}

export default function Trade() {
  return <DashboardPage topic="trade">{(dashboard) => <TradeBody dashboard={dashboard} />}</DashboardPage>;
}
