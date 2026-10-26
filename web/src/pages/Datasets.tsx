import { Link } from "react-router-dom";
import { TOPICS } from "../components/Layout";
import { useI18n, type MessageKey } from "../i18n";
import { DATA_BASE, useCatalog, type CatalogObject } from "../lib/data";
import { finestPeriod, formatDate, formatNumber, formatPeriod } from "../lib/format";

function DatasetCard({ entry }: { entry: CatalogObject }) {
  const { lang, t, pick } = useI18n();
  const periodType = finestPeriod(entry.period_types);
  const source = entry.sources[0];
  return (
    <article className="card">
      <p className="small muted" style={{ marginBottom: 4 }}>
        <span className={`badge ${entry.kind === "view" ? "accent" : ""}`}>
          {entry.kind === "view" ? t("data.view") : t("data.table")}
        </span>{" "}
        <code>{entry.name}</code>
      </p>
      <h3>{pick(entry.title)}</h3>
      <p className="subtitle">{pick(entry.description)}</p>
      <dl className="small" style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "2px 12px", margin: "0 0 12px" }}>
        {entry.unit && (
          <>
            <dt className="muted">{t("data.unit")}</dt>
            <dd style={{ margin: 0 }}>{pick(entry.unit)}</dd>
          </>
        )}
        {entry.first_period && (
          <>
            <dt className="muted">{t("data.coverage")}</dt>
            <dd style={{ margin: 0 }}>
              {t("common.coverage", {
                from: formatPeriod(lang, entry.first_period, periodType),
                to: formatPeriod(lang, entry.last_period, periodType),
              })}
            </dd>
          </>
        )}
        <dt className="muted">{t("common.source")}</dt>
        <dd style={{ margin: 0 }}>
          {source ? t("common.retrieved", { date: formatDate(lang, source.retrieved_at) }) : "—"}
          {" · "}
          {t("common.rows", { count: formatNumber(lang, entry.row_count, { digits: 0 }) })}
        </dd>
      </dl>
      <div className="actions">
        <Link className="button primary" to={`/${lang}/data/${entry.name}`}>
          {t("data.open")}
        </Link>
        <a className="button" href={`${DATA_BASE}/${entry.file}`} download>
          {t("common.downloadParquet")} · {formatNumber(lang, entry.bytes / 1024, { digits: 0 })} KB
        </a>
        {entry.kind === "table" && source && (
          <a
            className="button ghost"
            href={lang === "ka" ? source.web_url.replace("/pxweb/en/", "/pxweb/ka/") : source.web_url}
            target="_blank"
            rel="noreferrer"
          >
            {t("data.geostat")}
          </a>
        )}
      </div>
    </article>
  );
}

export function Datasets() {
  const { t } = useI18n();
  const { data: catalog, error } = useCatalog();
  return (
    <>
      <div className="page-head">
        <h1>{t("data.title")}</h1>
        <p className="lede">{t("data.lede")}</p>
      </div>
      {error && <p className="notice">{t("common.error")}</p>}
      {!catalog && !error && <p className="loading">{t("common.loading")}</p>}
      {catalog &&
        TOPICS.map((topic) => {
          const entries = catalog.objects.filter((entry) => entry.topic === topic);
          if (!entries.length) return null;
          return (
            <section key={topic} className="section">
              <h2>{t(`nav.${topic}` as MessageKey)}</h2>
              <div className="grid cols-2">
                {entries.map((entry) => (
                  <DatasetCard key={entry.name} entry={entry} />
                ))}
              </div>
            </section>
          );
        })}
    </>
  );
}
