import { useEffect } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { LANG_NAMES, LANGS, useI18n, type MessageKey } from "../i18n";
import { latestRetrieval, useCatalog } from "../lib/data";
import { formatDate } from "../lib/format";
import { setTheme, useTheme } from "../lib/theme";

export const TOPICS = ["prices", "wages", "labour", "economy", "trade", "population", "regions"] as const;
export type Topic = (typeof TOPICS)[number];

const NAV: { path: string; key: MessageKey }[] = [
  { path: "", key: "nav.overview" },
  { path: "prices", key: "nav.prices" },
  { path: "prices/products", key: "nav.products" },
  ...TOPICS.filter((topic) => topic !== "prices").map((topic) => ({ path: topic, key: `nav.${topic}` as MessageKey })),
  { path: "data", key: "nav.data" },
  { path: "sql", key: "nav.sql" },
  { path: "about", key: "nav.about" },
];

const REPO_URL = "https://github.com/GeorgiyKvatsbaya/georgia-in-numbers";

function ThemeToggle() {
  const { t } = useI18n();
  const theme = useTheme();
  const next = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      className="icon-button"
      onClick={() => setTheme(next)}
      aria-label={t("theme.toggle")}
      title={t("theme.toggle")}
    >
      {theme === "dark" ? (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      ) : (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
        </svg>
      )}
    </button>
  );
}

function LanguageSwitch() {
  const { lang, t } = useI18n();
  const location = useLocation();
  // Keep the same page when switching: replace only the language prefix.
  const rest = location.pathname.replace(/^\/(en|ka|ru)(?=\/|$)/, "");
  return (
    <nav className="segmented" aria-label={t("lang.label")}>
      {LANGS.map((code) => (
        <Link
          key={code}
          to={`/${code}${rest}${location.search}`}
          className={code === lang ? "active" : undefined}
          aria-current={code === lang ? "true" : undefined}
          hrefLang={code}
          lang={code}
          onClick={() => {
            try {
              localStorage.setItem("gin-lang", code);
            } catch {
              // Ignore storage failures.
            }
          }}
        >
          {LANG_NAMES[code]}
        </Link>
      ))}
    </nav>
  );
}

export function Layout() {
  const { lang, t, pick } = useI18n();
  const { data: catalog } = useCatalog();
  const retrieved = latestRetrieval(catalog);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  return (
    <>
      <a className="skip-link" href="#main">
        {t("nav.skip")}
      </a>
      <header className="site-header">
        <div className="container">
          <div className="header-row">
            <Link to={`/${lang}`} className="brand">
              <img src="/favicon.svg" alt="" />
              <span>{t("site.name")}</span>
            </Link>
            <div className="header-tools">
              <LanguageSwitch />
              <ThemeToggle />
            </div>
          </div>
          <nav className="nav" aria-label="Main">
            {NAV.map(({ path, key }) => (
              <NavLink key={key} to={`/${lang}${path ? `/${path}` : ""}`} end={path === "" || path === "prices"}>
                {t(key)}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      <main id="main">
        <div className="container">
          <Outlet />
        </div>
      </main>
      <footer className="site-footer">
        <div className="container footer-grid">
          <div>
            {catalog && (
              <p>
                {t("footer.source", {
                  source: pick(catalog.source.name),
                  date: formatDate(lang, retrieved),
                })}{" "}
                <a href={catalog.source.url} target="_blank" rel="noreferrer">
                  geostat.ge
                </a>
              </p>
            )}
            <p>{t("footer.unofficial")}</p>
          </div>
          <div>
            <a href={REPO_URL} target="_blank" rel="noreferrer">
              {t("footer.code")}
            </a>
          </div>
        </div>
      </footer>
    </>
  );
}
