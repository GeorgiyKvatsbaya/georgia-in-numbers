import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ChartCard } from "../components/ChartCard";
import { MapChart } from "../components/MapChart";
import { useI18n } from "../i18n";
import { latestBy, rankedBarChart, timeSeriesChart, toSeries } from "../lib/charts";
import { useDashboard, type Dashboard } from "../lib/data";
import { formatPeriod } from "../lib/format";
import { useLabels } from "../lib/labels";
import { DashboardPage, maxPeriod, useRows } from "./shared";

const HEADLINE_SERIES = ["Headline CPI inflation", "Core inflation", "Harmonised CPI (HICP)"];
const PRODUCER_SERIES = ["Producer price index, industrial products", "Export price index", "Import price index"];

function PricesBody({ dashboard }: { dashboard: Dashboard }) {
  const { lang, t } = useI18n();
  const label = useLabels();
  const headline = useRows(dashboard, "headline");
  const measures = useRows(dashboard, "measures");
  const components = useRows(dashboard, "components");
  const byGroup = useRows(dashboard, "by_group");
  const byCity = useRows(dashboard, "by_city");
  const basket = useRows(dashboard, "basket");
  const producer = useRows(dashboard, "producer");
  const construction = useRows(dashboard, "construction");
  const basketYear = useRows(dashboard, "basket_year")[0]?.year;

  const charts = useMemo(() => {
    const headlineRows = headline.filter((row) => row.inflation_yoy_pct !== null);
    const groupsLatest = latestBy(byGroup);
    const citiesLatest = latestBy(byCity);
    const coicop = basket.filter((row) => row.classification === "COICOP division");
    return {
      headlineRows,
      headline: timeSeriesChart({ lang, period: "month", unit: "%", baseline: 0, area: true, series: toSeries(headlineRows, "inflation_yoy_pct") }),
      measuresRows: measures.filter((row) => HEADLINE_SERIES.includes(String(row.measure))),
      measures: timeSeriesChart({
        lang, period: "month", unit: "%", baseline: 0, label,
        series: HEADLINE_SERIES.flatMap((name) => toSeries(measures.filter((row) => row.measure === name), "inflation_yoy_pct", "measure")),
      }),
      components: timeSeriesChart({ lang, period: "month", unit: "%", baseline: 0, label, series: toSeries(components, "inflation_yoy_pct", "component") }),
      groupsLatest,
      groups: rankedBarChart({ lang, unit: "%", diverging: true, items: groupsLatest.map((row) => ({ label: label(row.consumption_group), value: row.inflation_yoy_pct as number })) }),
      citiesLatest,
      cities: rankedBarChart({ lang, unit: "%", diverging: true, highlight: label("Georgia"), items: citiesLatest.map((row) => ({ label: label(row.region), value: row.inflation_yoy_pct as number })) }),
      coicop,
      basket: rankedBarChart({ lang, unit: "%", items: coicop.map((row) => ({ label: label(row.item), value: row.weight_pct as number })) }),
      producerRows: producer.filter((row) => PRODUCER_SERIES.includes(String(row.series))),
      producer: timeSeriesChart({
        lang, period: "month", digits: 1, baseline: 100, label,
        series: PRODUCER_SERIES.flatMap((name) => toSeries(producer.filter((row) => row.series === name), "index_2020_100", "series")),
      }),
      construction: timeSeriesChart({ lang, period: "month", digits: 1, baseline: 100, label, series: toSeries(construction, "index_feb2022_100", "component") }),
    };
  }, [lang, label, headline, measures, components, byGroup, byCity, basket, producer, construction]);

  return (
    <>
      <div className="grid cols-2">
        <ChartCard wide title={t("prices.headlineTitle")} subtitle={t("prices.headlineSub")} build={charts.headline}
          rows={charts.headlineRows} columns={["period_start", "inflation_yoy_pct", "inflation_mom_pct", "cpi_2010_100"]}
          sources={["inflation_monthly"]} filename="inflation" />
        <ChartCard title={t("prices.measuresTitle")} subtitle={t("prices.measuresSub")} build={charts.measures}
          rows={charts.measuresRows} columns={["measure", "period_start", "inflation_yoy_pct"]}
          sources={["inflation_measures_monthly"]} filename="inflation-measures" />
        <ChartCard title={t("prices.componentsTitle")} subtitle={t("prices.componentsSub")} build={charts.components}
          rows={components} columns={["component", "period_start", "inflation_yoy_pct"]}
          sources={["inflation_components_monthly"]} filename="inflation-components" />
        <ChartCard tall title={t("prices.groupsTitle")} subtitle={t("prices.groupsSub", { period: formatPeriod(lang, maxPeriod(byGroup), "month") })}
          build={charts.groups} rows={charts.groupsLatest} columns={["consumption_group", "period_start", "inflation_yoy_pct"]}
          sources={["inflation_yoy_monthly"]} filename="inflation-by-group" />
        <ChartCard tall title={t("prices.citiesTitle")} subtitle={t("prices.groupsSub", { period: formatPeriod(lang, maxPeriod(byCity), "month") })}
          build={charts.cities} rows={charts.citiesLatest} columns={["region", "period_start", "inflation_yoy_pct"]}
          sources={["inflation_yoy_monthly"]} filename="inflation-by-city" />
        <ChartCard tall title={t("prices.basketTitle")} subtitle={t("prices.basketSub", { year: String(basketYear ?? "") })}
          build={charts.basket} rows={basket} columns={["classification", "item", "weight_pct"]}
          sources={["cpi_basket_weights_annual"]} filename="cpi-basket" />
        <Link to={`/${lang}/prices/products`} className="card" style={{ alignSelf: "start" }}>
          <p className="eyebrow">{t("nav.products")}</p>
          <h3>{t("prices.productsCta")} →</h3>
          <p className="subtitle">{t("prices.productsCtaText")}</p>
        </Link>
        <ChartCard title={t("prices.producerTitle")} subtitle={t("prices.producerSub")} build={charts.producer}
          rows={charts.producerRows} columns={["series", "period_start", "index_2020_100"]}
          sources={["producer_prices_monthly"]} filename="producer-prices" />
        <ChartCard title={t("prices.constructionTitle")} subtitle={t("prices.constructionSub")} build={charts.construction}
          rows={construction} columns={["component", "period_start", "index_feb2022_100"]}
          sources={["construction_costs_monthly"]} filename="construction-costs" />
      </div>
      <Housing />
    </>
  );
}

const DWELLINGS = ["Flats", "Detached houses"] as const;
type Dwelling = (typeof DWELLINGS)[number];

/** Tbilisi district map + ranking and the national property price index. */
function Housing() {
  const { data } = useDashboard("housing");
  return data ? <HousingBody dashboard={data} /> : null;
}

function HousingBody({ dashboard }: { dashboard: Dashboard }) {
  const { lang, t } = useI18n();
  const label = useLabels();
  const [dwelling, setDwelling] = useState<Dwelling>("Flats");
  const latest = useRows(dashboard, "latest");
  const national = useRows(dashboard, "national");
  const selected = useMemo(() => latest.filter((row) => row.dwelling_type === dwelling), [latest, dwelling]);
  const values = useMemo(
    () => new Map(selected.map((row) => [String(row.district), Number(row.median_price_gel_m2)])),
    [selected],
  );
  const period = formatPeriod(lang, maxPeriod(selected), "quarter");
  const ranking = useMemo(
    () =>
      rankedBarChart({
        lang,
        digits: 0,
        items: selected.map((row) => ({ label: label(row.district), value: row.median_price_gel_m2 as number })),
      }),
    [lang, label, selected],
  );
  const rppi = useMemo(
    () =>
      timeSeriesChart({ lang, period: "quarter", digits: 1, baseline: 100, label, series: toSeries(national, "rppi_2020_100", "dwelling_type") }),
    [lang, label, national],
  );
  const nameOf = useCallback((id: string) => label(id), [label]);
  const toggle = (
    <div className="segmented" role="group">
      {DWELLINGS.map((type) => (
        <button
          key={type}
          type="button"
          className={type === dwelling ? "active" : undefined}
          aria-pressed={type === dwelling}
          onClick={() => setDwelling(type)}
        >
          {label(type)}
        </button>
      ))}
    </div>
  );
  return (
    <section className="section">
      <h2>{t("prices.housing")}</h2>
      <div className="grid cols-2">
        <ChartCard title={t("prices.tbilisiTitle")} subtitle={t("prices.tbilisiSub", { period })} controls={toggle}
          rows={selected} columns={["district", "dwelling_type", "period_start", "median_price_gel_m2", "change_yoy_pct"]}
          period="quarter" sources={["tbilisi_property_quarterly"]} filename="tbilisi-housing">
          <MapChart layer="tbilisi_districts" values={values} nameOf={nameOf} label={t("prices.tbilisiTitle")} unit=" ₾/m²" />
        </ChartCard>
        <ChartCard title={t("prices.tbilisiTitle")} subtitle={t("prices.tbilisiSub", { period })} build={ranking}
          rows={selected} columns={["district", "period_start", "median_price_gel_m2", "change_yoy_pct"]}
          period="quarter" sources={["tbilisi_property_quarterly"]} filename="tbilisi-housing-ranking" />
        <ChartCard wide title={t("prices.rppiTitle")} subtitle={t("prices.producerSub")} build={rppi}
          rows={national} columns={["dwelling_type", "period_start", "rppi_2020_100"]} period="quarter"
          sources={["property_prices_quarterly"]} filename="property-prices" />
      </div>
    </section>
  );
}

export default function Prices() {
  return <DashboardPage topic="prices">{(dashboard) => <PricesBody dashboard={dashboard} />}</DashboardPage>;
}
