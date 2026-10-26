import { useMemo } from "react";
import { Link } from "react-router-dom";
import { KpiTile } from "../components/KpiTile";
import { TOPICS } from "../components/Layout";
import { useI18n, type MessageKey } from "../i18n";
import { toRows, useDashboard, type Row } from "../lib/data";
import { formatNumber, formatPeriod, type PeriodType } from "../lib/format";

const MILLION = { en: "M", ka: "მლნ", ru: "млн" } as const;

interface KpiSpec {
  series: string;
  label: MessageKey;
  period: PeriodType;
  to: string;
  format: (value: number) => string;
  /** How to express the change versus a year earlier. */
  change: "points" | "percent";
  /** Whether an increase is good news (undefined = neutral). */
  upIsGood?: boolean;
  /** Observations per year, to find the value a year earlier. */
  perYear: number;
}

export function Home() {
  const { lang, t } = useI18n();
  const { data } = useDashboard("home");

  const specs: KpiSpec[] = useMemo(
    () => [
      { series: "inflation", label: "kpi.inflation", period: "month", to: "prices", perYear: 12, change: "points", upIsGood: false, format: (v) => `${formatNumber(lang, v)}%` },
      { series: "real_wages", label: "kpi.realWages", period: "quarter", to: "wages", perYear: 4, change: "points", upIsGood: true, format: (v) => `${formatNumber(lang, v, { signed: true })}%` },
      { series: "unemployment", label: "kpi.unemployment", period: "quarter", to: "labour", perYear: 4, change: "points", upIsGood: false, format: (v) => `${formatNumber(lang, v)}%` },
      { series: "gdp_growth", label: "kpi.gdpGrowth", period: "quarter", to: "economy", perYear: 4, change: "points", upIsGood: true, format: (v) => `${formatNumber(lang, v, { signed: true })}%` },
      { series: "population", label: "kpi.population", period: "annual", to: "population", perYear: 1, change: "percent", format: (v) => `${formatNumber(lang, v / 1000, { digits: 2 })} ${MILLION[lang]}` },
      { series: "exchange_rate", label: "kpi.exchangeRate", period: "quarter", to: "economy", perYear: 4, change: "percent", format: (v) => `${formatNumber(lang, v, { digits: 3 })} ₾` },
    ],
    [lang],
  );

  const tiles = useMemo(
    () =>
      specs.map((spec) => {
        const rows = toRows(data?.series[spec.series]).filter((row: Row) => row.value !== null);
        const last = rows.at(-1);
        const prior = rows.at(-1 - spec.perYear);
        if (!last) return { spec, value: "—", meta: "", trend: [] as number[] };
        const value = Number(last.value);
        let delta;
        if (prior) {
          const diff = spec.change === "points" ? value - Number(prior.value) : 100 * (value / Number(prior.value) - 1);
          const unit = spec.change === "points" ? (lang === "en" ? " pp" : lang === "ru" ? " п.п." : " პ.პ.") : "%";
          delta = {
            text: t("common.vsYearAgo", { value: `${formatNumber(lang, diff, { signed: true })}${unit}` }),
            direction: diff > 0 ? ("up" as const) : diff < 0 ? ("down" as const) : ("flat" as const),
            good: spec.upIsGood === undefined || diff === 0 ? undefined : (diff > 0) === spec.upIsGood,
          };
        }
        const preliminary = last.is_preliminary ? ` · ${t("common.preliminary")}` : "";
        return {
          spec,
          value: spec.format(value),
          meta: `${formatPeriod(lang, String(last.period_start), spec.period)}${preliminary}`,
          delta,
          trend: rows.slice(-3 * spec.perYear - 1).map((row) => Number(row.value)),
        };
      }),
    [specs, data, lang, t],
  );

  return (
    <>
      <div className="page-head">
        <p className="eyebrow">{t("site.tagline")}</p>
        <h1>{t("home.title")}</h1>
        <p className="lede">{t("home.lede")}</p>
      </div>

      <section className="section" aria-labelledby="kpis">
        <h2 id="kpis">{t("home.kpis")}</h2>
        <div className="kpi-grid">
          {tiles.map(({ spec, value, meta, delta, trend }) => (
            <KpiTile key={spec.series} label={t(spec.label)} value={value} meta={meta} delta={delta} trend={trend} to={`/${lang}/${spec.to}`} />
          ))}
        </div>
      </section>

      <section className="section" aria-labelledby="topics">
        <h2 id="topics">{t("home.topics")}</h2>
        <div className="grid cols-3">
          {TOPICS.map((topic) => (
            <Link key={topic} to={`/${lang}/${topic}`} className="card">
              <h3>{t(`nav.${topic}` as MessageKey)}</h3>
              <p className="subtitle">{t(`topic.${topic}` as MessageKey)}</p>
            </Link>
          ))}
          <Link to={`/${lang}/prices/products`} className="card">
            <h3>{t("nav.products")}</h3>
            <p className="subtitle">{t("prices.productsCtaText")}</p>
          </Link>
        </div>
      </section>

      <section className="section" aria-labelledby="tools">
        <h2 id="tools">{t("home.tools")}</h2>
        <div className="grid cols-2">
          <Link to={`/${lang}/data`} className="card">
            <h3>{t("home.explore.title")}</h3>
            <p className="subtitle">{t("home.explore.text")}</p>
          </Link>
          <Link to={`/${lang}/sql`} className="card">
            <h3>{t("home.sql.title")}</h3>
            <p className="subtitle">{t("home.sql.text")}</p>
          </Link>
        </div>
      </section>
    </>
  );
}
