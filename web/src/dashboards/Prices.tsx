import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ChartCard } from "../components/ChartCard";
import { FilterBar, inRange, RangeFilter, SelectFilter, useParamState, useRange } from "../components/Filters";
import { MapChart } from "../components/MapChart";
import { useI18n } from "../i18n";
import { latestBy, rankedBarChart, timeSeriesChart, toSeries } from "../lib/charts";
import { useDashboard, type Dashboard } from "../lib/data";
import { formatPeriod } from "../lib/format";
import { useLabels } from "../lib/labels";
import { DashboardPage, maxPeriod, useRows } from "./shared";

const HEADLINE_SERIES = ["Headline CPI inflation", "Core inflation", "Harmonised CPI (HICP)"];
const PRODUCER_SERIES = ["Producer price index, industrial products", "Export price index", "Import price index"];
const CITIES = ["Georgia", "Tbilisi", "Batumi", "Kutaisi", "Gori", "Telavi", "Zugdidi"];

function PricesBody({ dashboard }: { dashboard: Dashboard }) {
  const { lang, t } = useI18n();
  const label = useLabels();
  const { range, setRange, start } = useRange();
  const [city, setCity] = useParamState("city", "Georgia");
  const [group, setGroup] = useParamState("group", "Food and non-alcoholic beverages");
  const headline = useRows(dashboard, "headline");
  const measures = useRows(dashboard, "measures");
  const components = useRows(dashboard, "components");
  const byGroup = useRows(dashboard, "by_group");
  const byCity = useRows(dashboard, "by_city");
  const groupsHistory = useRows(dashboard, "groups_history");
  const basket = useRows(dashboard, "basket");
  const producer = useRows(dashboard, "producer");
  const construction = useRows(dashboard, "construction");
  const basketYear = useRows(dashboard, "basket_year")[0]?.year;
  const groups = useMemo(() => [...new Set(byGroup.map((row) => String(row.consumption_group)))].filter((name) => name !== "Total"), [byGroup]);

  const charts = useMemo(() => {
    const headlineRows = inRange(
      city === "Georgia"
        ? headline.filter((row) => row.inflation_yoy_pct !== null)
        : byCity.filter((row) => row.region === city),
      start,
    );
    const groupsLatest = byGroup.filter((row) => row.region === city);
    const citiesLatest = latestBy(byCity);
    const coicop = basket.filter((row) => row.classification === "COICOP division");
    const trendRows = inRange(groupsHistory.filter((row) => row.region === city && (row.consumption_group === group || row.consumption_group === "Total")), start);
    const measuresRows = inRange(measures.filter((row) => HEADLINE_SERIES.includes(String(row.measure))), start);
    const producerRows = inRange(producer.filter((row) => PRODUCER_SERIES.includes(String(row.series))), start);
    const componentRows = inRange(components, start);
    const constructionRows = inRange(construction, start);
    return {
      headlineRows,
      headline: timeSeriesChart({ lang, period: "month", unit: "%", baseline: 0, area: true, series: toSeries(headlineRows, "inflation_yoy_pct") }),
      measuresRows,
      measures: timeSeriesChart({
        lang, period: "month", unit: "%", baseline: 0, label,
        series: HEADLINE_SERIES.flatMap((name) => toSeries(measuresRows.filter((row) => row.measure === name), "inflation_yoy_pct", "measure")),
      }),
      componentRows,
      components: timeSeriesChart({ lang, period: "month", unit: "%", baseline: 0, label, series: toSeries(componentRows, "inflation_yoy_pct", "component") }),
      groupsLatest,
      groups: rankedBarChart({ lang, unit: "%", diverging: true, highlight: label("Total"), items: groupsLatest.map((row) => ({ label: label(row.consumption_group), value: row.inflation_yoy_pct as number })) }),
      trendRows,
      trend: timeSeriesChart({
        lang, period: "month", unit: "%", baseline: 0, label,
        series: [group, "Total"].flatMap((name) => toSeries(trendRows.filter((row) => row.consumption_group === name), "inflation_yoy_pct", "consumption_group")),
      }),
      citiesLatest,
      cities: rankedBarChart({ lang, unit: "%", diverging: true, highlight: label(city), items: citiesLatest.map((row) => ({ label: label(row.region), value: row.inflation_yoy_pct as number })) }),
      coicop,
      basket: rankedBarChart({ lang, unit: "%", items: coicop.map((row) => ({ label: label(row.item), value: row.weight_pct as number })) }),
      producerRows,
      producer: timeSeriesChart({
        lang, period: "month", digits: 1, baseline: 100, label,
        series: PRODUCER_SERIES.flatMap((name) => toSeries(producerRows.filter((row) => row.series === name), "index_2020_100", "series")),
      }),
      constructionRows,
      construction: timeSeriesChart({ lang, period: "month", digits: 1, baseline: 100, label, series: toSeries(constructionRows, "index_feb2022_100", "component") }),
    };
  }, [lang, label, city, group, start, headline, measures, components, byGroup, byCity, groupsHistory, basket, producer, construction]);

  const cityName = label(city);
  const latestMonth = formatPeriod(lang, maxPeriod(byGroup), "month");
  return (
    <>
      <FilterBar>
        <RangeFilter range={range} setRange={setRange} />
        <SelectFilter label={t("filters.city")} value={city} onChange={setCity} options={CITIES.map((value) => ({ value, label: label(value) }))} />
      </FilterBar>
      <div className="grid cols-2">
        <ChartCard wide title={t("prices.headlineCityTitle", { city: cityName })} subtitle={t("prices.headlineSub")} info={t("info.inflation")}
          build={charts.headline} rows={charts.headlineRows} columns={city === "Georgia" ? ["period_start", "inflation_yoy_pct", "inflation_mom_pct", "cpi_2010_100"] : ["region", "period_start", "inflation_yoy_pct"]}
          sources={[city === "Georgia" ? "inflation_monthly" : "inflation_yoy_monthly"]} filename="inflation" />
        <ChartCard title={t("prices.measuresTitle")} subtitle={t("prices.measuresSub")} info={t("info.measures")} build={charts.measures}
          rows={charts.measuresRows} columns={["measure", "period_start", "inflation_yoy_pct"]}
          sources={["inflation_measures_monthly"]} filename="inflation-measures" />
        <ChartCard title={t("prices.componentsTitle")} subtitle={t("prices.componentsSub")} info={t("info.components")} build={charts.components}
          rows={charts.componentRows} columns={["component", "period_start", "inflation_yoy_pct"]}
          sources={["inflation_components_monthly"]} filename="inflation-components" />
        <ChartCard tall title={t("prices.cityGroupsTitle", { city: cityName })} subtitle={t("prices.groupsSub", { period: latestMonth })} info={t("info.groups")}
          build={charts.groups} rows={charts.groupsLatest} columns={["region", "consumption_group", "period_start", "inflation_yoy_pct"]}
          sources={["inflation_yoy_monthly"]} filename="inflation-by-group" />
        <ChartCard tall title={t("prices.groupTrendTitle")} subtitle={`${cityName} · ${t("prices.headlineSub")}`} info={t("info.groupTrend")}
          controls={<SelectFilter label={t("filters.group")} value={group} onChange={setGroup} options={groups.map((value) => ({ value, label: label(value) }))} />}
          build={charts.trend} rows={charts.trendRows} columns={["region", "consumption_group", "period_start", "inflation_yoy_pct"]}
          sources={["inflation_yoy_monthly"]} filename="inflation-group-trend" />
        <ChartCard tall title={t("prices.citiesTitle")} subtitle={t("prices.groupsSub", { period: formatPeriod(lang, maxPeriod(byCity), "month") })} info={t("info.cities")}
          build={charts.cities} rows={charts.citiesLatest} columns={["region", "period_start", "inflation_yoy_pct"]}
          sources={["inflation_yoy_monthly"]} filename="inflation-by-city" />
        <ChartCard tall title={t("prices.basketTitle")} subtitle={t("prices.basketSub", { year: String(basketYear ?? "") })} info={t("info.basket")}
          build={charts.basket} rows={basket} columns={["classification", "item", "weight_pct"]}
          sources={["cpi_basket_weights_annual"]} filename="cpi-basket" />
        <ChartCard title={t("prices.producerTitle")} subtitle={t("prices.producerSub")} info={t("info.producer")} build={charts.producer}
          rows={charts.producerRows} columns={["series", "period_start", "index_2020_100"]}
          sources={["producer_prices_monthly"]} filename="producer-prices" />
        <ChartCard title={t("prices.constructionTitle")} subtitle={t("prices.constructionSub")} info={t("info.construction")} build={charts.construction}
          rows={charts.constructionRows} columns={["component", "period_start", "index_feb2022_100"]}
          sources={["construction_costs_monthly"]} filename="construction-costs" />
        <Link to={`/${lang}/prices/products`} className="card" style={{ alignSelf: "start" }}>
          <p className="eyebrow">{t("nav.products")}</p>
          <h3>{t("prices.productsCta")} →</h3>
          <p className="subtitle">{t("prices.productsCtaText")}</p>
        </Link>
      </div>
      <Housing start={start} />
    </>
  );
}

const DWELLINGS = ["Flats", "Detached houses"] as const;
type Dwelling = (typeof DWELLINGS)[number];

/** Tbilisi district map + ranking and the national property price index. */
function Housing({ start }: { start: string }) {
  const { data } = useDashboard("housing");
  return data ? <HousingBody dashboard={data} start={start} /> : null;
}

function HousingBody({ dashboard, start }: { dashboard: Dashboard; start: string }) {
  const { lang, t } = useI18n();
  const label = useLabels();
  const [dwelling, setDwelling] = useState<Dwelling>("Flats");
  const latest = useRows(dashboard, "latest");
  const allNational = useRows(dashboard, "national");
  const national = useMemo(() => inRange(allNational, start), [allNational, start]);
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
        <ChartCard title={t("prices.tbilisiTitle")} subtitle={t("prices.tbilisiSub", { period })} controls={toggle} info={t("info.tbilisi")}
          rows={selected} columns={["district", "dwelling_type", "period_start", "median_price_gel_m2", "change_yoy_pct"]}
          period="quarter" sources={["tbilisi_property_quarterly"]} filename="tbilisi-housing">
          <MapChart layer="tbilisi_districts" values={values} nameOf={nameOf} label={t("prices.tbilisiTitle")} unit=" ₾/m²" />
        </ChartCard>
        <ChartCard title={t("prices.tbilisiTitle")} subtitle={t("prices.tbilisiSub", { period })} build={ranking}
          rows={selected} columns={["district", "period_start", "median_price_gel_m2", "change_yoy_pct"]}
          period="quarter" sources={["tbilisi_property_quarterly"]} filename="tbilisi-housing-ranking" />
        <ChartCard wide title={t("prices.rppiTitle")} subtitle={t("prices.producerSub")} info={t("info.rppi")} build={rppi}
          rows={national} columns={["dwelling_type", "period_start", "rppi_2020_100"]} period="quarter"
          sources={["property_prices_quarterly"]} filename="property-prices" />
      </div>
    </section>
  );
}

export default function Prices() {
  return <DashboardPage topic="prices">{(dashboard) => <PricesBody dashboard={dashboard} />}</DashboardPage>;
}
