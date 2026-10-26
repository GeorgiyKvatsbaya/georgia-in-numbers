import { useMemo } from "react";
import { ChartCard } from "../components/ChartCard";
import { useI18n } from "../i18n";
import { columnChart, timeSeriesChart, toSeries } from "../lib/charts";
import type { Dashboard } from "../lib/data";
import { DashboardPage, useRows } from "./shared";

function TradeBody({ dashboard }: { dashboard: Dashboard }) {
  const { lang, t } = useI18n();
  const quarterly = useRows(dashboard, "quarterly");
  const annual = useRows(dashboard, "annual");

  const charts = useMemo(() => {
    const preliminary = new Set(quarterly.filter((row) => row.is_preliminary).map((row) => String(row.period_start)));
    const annualRows = annual.map((row) => ({ ...row, period_start: `${row.year}-01-01` }));
    return {
      flows: timeSeriesChart({
        lang, period: "quarter", digits: 0,
        series: [...toSeries(quarterly, "exports_mln_gel", undefined, t("trade.exports")), ...toSeries(quarterly, "imports_mln_gel", undefined, t("trade.imports"))],
      }),
      balance: columnChart({
        lang, period: "quarter", digits: 0, muted: (date) => preliminary.has(date),
        points: quarterly.map((row) => [String(row.period_start), row.net_exports_mln_gel as number]),
      }),
      composition: timeSeriesChart({
        lang, period: "quarter", digits: 0,
        series: [...toSeries(quarterly, "exports_goods_mln_gel", undefined, t("trade.goods")), ...toSeries(quarterly, "exports_services_mln_gel", undefined, t("trade.services"))],
      }),
      open: timeSeriesChart({
        lang, period: "annual", unit: "%",
        series: [...toSeries(annualRows, "exports_share_of_gdp_pct", undefined, t("trade.exports")), ...toSeries(annualRows, "imports_share_of_gdp_pct", undefined, t("trade.imports"))],
      }),
    };
  }, [lang, t, quarterly, annual]);

  return (
    <>
      <p className="notice" style={{ marginBottom: 16 }}>{t("trade.note")}</p>
      <div className="grid cols-2">
        <ChartCard wide title={t("trade.flowsTitle")} subtitle={t("trade.flowsSub")} build={charts.flows} period="quarter"
          rows={quarterly} columns={["period_start", "exports_mln_gel", "imports_mln_gel", "net_exports_mln_gel", "is_preliminary"]}
          sources={["gdp_headline"]} filename="exports-imports" />
        <ChartCard title={t("trade.balanceTitle")} subtitle={t("trade.balanceSub")} build={charts.balance} period="quarter"
          rows={quarterly} columns={["period_start", "net_exports_mln_gel"]} sources={["gdp_headline"]} filename="trade-balance" />
        <ChartCard title={t("trade.compositionTitle")} subtitle={t("trade.flowsSub")} build={charts.composition} period="quarter"
          rows={quarterly} columns={["period_start", "exports_goods_mln_gel", "exports_services_mln_gel", "imports_goods_mln_gel", "imports_services_mln_gel"]}
          sources={["gdp_headline"]} filename="exports-goods-services" />
        <ChartCard wide title={t("trade.openTitle")} subtitle={t("trade.openSub")} build={charts.open} period="annual"
          rows={annual} columns={["year", "exports_mln_gel", "imports_mln_gel", "exports_share_of_gdp_pct", "imports_share_of_gdp_pct"]}
          sources={["gdp_headline"]} filename="trade-share-of-gdp" />
      </div>
    </>
  );
}

export default function Trade() {
  return <DashboardPage topic="trade">{(dashboard) => <TradeBody dashboard={dashboard} />}</DashboardPage>;
}
