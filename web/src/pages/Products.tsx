import { useMemo, useState } from "react";
import { ChartCard } from "../components/ChartCard";
import { FilterBar, inRange, RangeFilter, Segmented, SelectFilter, useParamState, useRange } from "../components/Filters";
import { Sparkline } from "../components/KpiTile";
import { useI18n } from "../i18n";
import { rankedBarChart, timeSeriesChart, toSeries } from "../lib/charts";
import { toRows, useDashboard, type Row } from "../lib/data";
import { formatNumber, formatPercent, formatPeriod } from "../lib/format";
import { useColumnLabels, useLabels } from "../lib/labels";

const SPARK_MONTHS = 24;
const MAX_COMPARE = 4;
type Sort = "name" | "up" | "down" | "price";
type Mode = "price" | "index";

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
  const [group, setGroup] = useParamState("group", "");
  const [sort, setSort] = useParamState<Sort>("sort", "name");
  const [mode, setMode] = useParamState<Mode>("mode", "price");
  const [selectedParam, setSelectedParam] = useParamState("products", "Wheat bread");
  const { range, setRange, start } = useRange("all");
  const selected = useMemo(() => selectedParam.split("|").filter(Boolean), [selectedParam]);
  const toggle = (name: string) => {
    const next = selected.includes(name)
      ? selected.filter((item) => item !== name)
      : [...selected, name].slice(-MAX_COMPARE);
    setSelectedParam((next.length ? next : [name]).join("|"));
  };

  const groups = useMemo(() => [...new Set(latest.map((row) => String(row.product_group)))], [latest]);
  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    const rows = latest.filter((row) => {
      if (group && row.product_group !== group) return false;
      if (!needle) return true;
      return [row.product, label(row.product)].some((name) => String(name).toLocaleLowerCase().includes(needle));
    });
    const change = (row: Row) => Number(row.change_yoy_pct ?? 0);
    const sorters: Record<Sort, (a: Row, b: Row) => number> = {
      name: (a, b) => label(a.product).localeCompare(label(b.product), lang),
      up: (a, b) => change(b) - change(a),
      down: (a, b) => change(a) - change(b),
      price: (a, b) => Number(b.price_gel) - Number(a.price_gel),
    };
    return [...rows].sort(sorters[sort] ?? sorters.name);
  }, [latest, query, group, label, sort, lang]);

  // Selection order, matching the legend and colour of each line.
  const chosen = selected.map((name) => latest.find((row) => row.product === name)).filter((row): row is Row => Boolean(row));
  const product = chosen.at(-1) ?? latest[0];
  const compareRows = useMemo(() => {
    const rows: Row[] = [];
    for (const name of selected) {
      const history = byProduct.get(name) ?? [];
      const base = Number(history.find((row) => String(row.period_start) >= "2020-01-01")?.price_gel);
      for (const row of history) {
        rows.push({ ...row, index_jan2020_100: base ? Math.round((10000 * Number(row.price_gel)) / base) / 100 : null });
      }
    }
    return inRange(rows, start);
  }, [selected, byProduct, start]);
  const detail = useMemo(
    () =>
      timeSeriesChart({
        lang,
        period: "month",
        digits: mode === "price" ? 2 : 1,
        unit: mode === "price" ? " ₾" : "",
        baseline: mode === "index" ? 100 : undefined,
        area: selected.length === 1,
        label,
        // Colour follows the product's position in the selection, not its rank.
        colorIndex: (name) => selected.indexOf(name),
        series: toSeries(compareRows, mode === "price" ? "price_gel" : "index_jan2020_100", "product"),
      }),
    [lang, label, mode, selected, compareRows],
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
          <FilterBar>
            <RangeFilter range={range} setRange={setRange} />
            <Segmented label={t("filters.show")} value={mode} onChange={setMode}
              options={[{ value: "price", label: t("filters.prices") }, { value: "index", label: t("filters.index") }]} />
          </FilterBar>
          <div className="grid cols-2">
            <ChartCard wide
              title={selected.length === 1 ? `${label(product.product)} · ${formatNumber(lang, product.price_gel, { digits: 2 })} ₾` : t("products.compareTitle")}
              subtitle={mode === "index" ? t("products.indexSub") : selected.length === 1 ? t("products.detailSub", { unit: unitText }) : t("products.compareSub")}
              info={t("info.product")}
              controls={
                <div className="chips">
                  {chosen.map((row) => (
                    <button key={String(row.product)} type="button" className="chip" onClick={() => toggle(String(row.product))}
                      aria-label={t("filters.remove", { name: label(row.product) })}>
                      {label(row.product)} · {label(row.unit_of_measure)} <span aria-hidden="true">×</span>
                    </button>
                  ))}
                  <span className="muted small">{t("filters.compareHint")}</span>
                </div>
              }
              build={detail} rows={compareRows} columns={["product", "period_start", "price_gel", "index_jan2020_100"]}
              sources={["retail_prices_monthly"]} filename="shop-prices" />
          </div>

          <section className="section">
            <div className="filter-row">
              <input className="input" type="search" placeholder={t("products.search")} aria-label={t("products.search")}
                value={query} onChange={(event) => setQuery(event.target.value)} />
              <SelectFilter label={t("filters.group")} value={group} onChange={setGroup}
                options={[{ value: "", label: t("products.allGroups") }, ...groups.map((name) => ({ value: name, label: label(name) }))]} />
              <SelectFilter label={t("filters.sort")} value={sort} onChange={(value) => setSort(value as Sort)}
                options={[
                  { value: "name", label: t("filters.sortName") },
                  { value: "up", label: t("filters.sortUp") },
                  { value: "down", label: t("filters.sortDown") },
                  { value: "price", label: t("filters.sortPrice") },
                ]} />
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
                    const active = selected.includes(String(row.product));
                    return (
                      <tr key={String(row.product)} className={active ? "active" : undefined}>
                        <td>
                          <button type="button" className="link-button" aria-pressed={active} title={t("products.select")}
                            onClick={() => toggle(String(row.product))}>
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
            <ChartCard tall title={t("products.risersTitle")} subtitle={t("products.overYear")} info={t("info.movers")} build={movers.risersChart}
              rows={movers.risers} columns={["product", "price_gel", "change_yoy_pct"]} sources={["retail_prices_monthly"]} filename="price-risers" />
            <ChartCard tall title={t("products.fallersTitle")} subtitle={t("products.overYear")} info={t("info.movers")} build={movers.fallersChart}
              rows={movers.fallers} columns={["product", "price_gel", "change_yoy_pct"]} sources={["retail_prices_monthly"]} filename="price-fallers" />
          </section>
        </>
      )}
    </>
  );
}
