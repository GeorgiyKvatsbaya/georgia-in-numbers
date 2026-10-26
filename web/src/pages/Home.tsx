import { Link } from "react-router-dom";
import { TOPICS } from "../components/Layout";
import { useI18n, type MessageKey } from "../i18n";

export function Home() {
  const { lang, t } = useI18n();
  return (
    <>
      <div className="page-head">
        <p className="eyebrow">{t("site.tagline")}</p>
        <h1>{t("home.title")}</h1>
        <p className="lede">{t("home.lede")}</p>
      </div>

      <section className="section" aria-labelledby="topics">
        <h2 id="topics">{t("home.topics")}</h2>
        <div className="grid cols-3">
          {TOPICS.map((topic) => (
            <Link key={topic} to={`/${lang}/${topic}`} className="card">
              <h3>{t(`nav.${topic}` as MessageKey)}</h3>
              <p className="subtitle">{t(`topic.${topic}` as MessageKey)}</p>
            </Link>
          ))}
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
