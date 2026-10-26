import { useMemo, useState } from "react";
import { ChartCard } from "../components/ChartCard";
import { Sparkline } from "../components/KpiTile";
import { useI18n } from "../i18n";
import { rankedBarChart, timeSeriesChart, toSeries } from "../lib/charts";
import { toRows, useDashboard, type Row } from "../lib/data";
import { formatNumber, formatPercent, formatPeriod } from "../lib/format";
import { useColumnLabels, useLabels } from "../lib/labels";

const SPARK_MONTHS = 24;

export default function Products() {
  const { lang, t } = useI18n();
  const label = useLabels();
  const columnLabel = useColumnLabels();
  const { data, error } = useDashboard("products");
  const latest = useMemo(() => toRows(data?.series.latest), [data]);
  const history = useMemo(() => toRows(data?.series.history), [data]);
  const byProduct = useMemo(() => {
    const map = new Map<string, Row[]>();
    for (const row of history) {
      const key = String(row.product);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(row);
    }
    return map;
  }, [history]);

  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("");
  const [selected, setSelected] = useState("Wheat bread");

  const groups = useMemo(() => [...new Set(latest.map((row) => String(row.product_group)))], [latest]);
  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return latest.filter((row) => {
      if (group && row.product_group !== group) return false;
      if (!needle) return true;
      return [row.product, label(row.product)].some((name) => String(name).toLocaleLowerCase().includes(needle));
    });
  }, [latest, query, group, label]);

  const product = latest.find((row) => row.product === selected) ?? latest[0];
  const productRows = product ? byProduct.get(String(product.product)) ?? [] : [];
  const detail = useMemo(
    () => timeSeriesChart({ lang, period: "month", digits: 2, unit: " ₾", area: true, series: toSeries(productRows, "price_gel") }),
    [lang, productRows],
  );
  const movers = useMemo(() => {
    const sorted = [...latest].filter((row) => row.change_yoy_pct !== null).sort((a, b) => Number(b.change_yoy_pct) - Number(a.change_yoy_pct));
    const top = (rows: Row[]) => rankedBarChart({ lang, unit: "%", diverging: true, items: rows.map((row) => ({ label: label(row.product), value: row.change_yoy_pct as number })) });
    const risers = sorted.slice(0, 10);
    const fallers = sorted.slice(-10).reverse();
    return { risers, fallers, risersChart: top(risers), fallersChart: top(fallers) };
  }, [latest, lang, label]);

  const period = formatPeriod(lang, latest[0] ? String(latest[0].period_start) : null, "month");
  const unitText = product ? label(product.unit_of_measure) : "";

  return (
    <>
      <div className="page-head">
        <h1>{t("products.title")}</h1>
        <p className="lede">{t("products.lede")}</p>
        {latest.length > 0 && <p className="muted small">{t("products.pricesFor", { period })}</p>}
      </div>
      {error && <p className="notice">{t("common.error")}</p>}
      {!data && !error && <p className="loading">{t("common.loading")}</p>}
      {data && product && (
        <>
          <div className="grid cols-2">
            <ChartCard wide title={`${label(product.product)} · ${formatNumber(lang, product.price_gel, { digits: 2 })} ₾`}
              subtitle={t("products.detailSub", { unit: unitText })} build={detail} rows={productRows}
              columns={["product", "period_start", "price_gel"]} sources={["retail_prices_monthly"]} filename={`price-${String(product.product)}`} />
          </div>

          <section className="section">
            <div className="filter-row">
              <input className="input" type="search" placeholder={t("products.search")} aria-label={t("products.search")}
                value={query} onChange={(event) => setQuery(event.target.value)} />
              <select className="select" value={group} onChange={(event) => setGroup(event.target.value)} aria-label={t("products.allGroups")}>
                <option value="">{t("products.allGroups")}</option>
                {groups.map((name) => (
                  <option key={name} value={name}>{label(name)}</option>
                ))}
              </select>
            </div>
            {visible.length === 0 && <p className="muted">{t("products.noResults")}</p>}
            <div className="card" style={{ padding: 0, overflow: "hidden" }}>
              <table className="data-table product-table">
                <thead>
                  <tr>
                    <th scope="col">{columnLabel("product")}</th>
                    <th scope="col" className="num">{t("products.price")}</th>
                    <th scope="col" className="num">{t("products.change")}</th>
                    <th scope="col" className="num hide-sm">{t("products.since2020")}</th>
                    <th scope="col" className="hide-sm" aria-hidden="true" />
                  </tr>
                </thead>
                <tbody>
                  {visible.map((row) => {
                    const change = Number(row.change_yoy_pct);
                    const spark = (byProduct.get(String(row.product)) ?? []).slice(-SPARK_MONTHS).map((point) => Number(point.price_gel));
                    const active = row.product === product.product;
                    return (
                      <tr key={String(row.product)} className={active ? "active" : undefined}>
                        <td>
                          <button type="button" className="link-button" aria-pressed={active} title={t("products.select")}
                            onClick={() => { setSelected(String(row.product)); window.scrollTo({ top: 0, behavior: "smooth" }); }}>
                            {label(row.product)}
                          </button>
                          <div className="muted small">{label(row.unit_of_measure)} · {label(row.product_group)}</div>
                        </td>
                        <td className="num">{formatNumber(lang, row.price_gel, { digits: 2 })} ₾</td>
                        <td className={`num ${change > 0 ? "delta-up" : change < 0 ? "delta-down" : ""}`}>
                          {formatPercent(lang, row.change_yoy_pct, 1, true)}
                        </td>
                        <td className="num hide-sm">{formatPercent(lang, row.change_since_2020_pct, 0, true)}</td>
                        <td className="hide-sm" style={{ width: 120 }}>{spark.length > 1 && <Sparkline values={spark} width={120} height={28} />}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section className="section grid cols-2">
            <ChartCard tall title={t("products.risersTitle")} subtitle={t("products.overYear")} build={movers.risersChart}
              rows={movers.risers} columns={["product", "price_gel", "change_yoy_pct"]} sources={["retail_prices_monthly"]} filename="price-risers" />
            <ChartCard tall title={t("products.fallersTitle")} subtitle={t("products.overYear")} build={movers.fallersChart}
              rows={movers.fallers} columns={["product", "price_gel", "change_yoy_pct"]} sources={["retail_prices_monthly"]} filename="price-fallers" />
          </section>
        </>
      )}
    </>
  );
}
