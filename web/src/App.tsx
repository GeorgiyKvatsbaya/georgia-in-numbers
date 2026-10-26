import { lazy, Suspense, useEffect } from "react";
import { Navigate, Outlet, Route, Routes, useParams } from "react-router-dom";
import { Layout, TOPICS } from "./components/Layout";
import { detectLang, I18nProvider, isLang, useI18n } from "./i18n";
import { About } from "./pages/About";
import { Datasets } from "./pages/Datasets";
import { Home } from "./pages/Home";
import { NotFound } from "./pages/NotFound";
import { TopicPage } from "./pages/TopicPage";

// Heavy pages (DuckDB-WASM, editor) load only when visited.
const Explore = lazy(() => import("./pages/Explore"));
const Sql = lazy(() => import("./pages/Sql"));

function LanguageRoot() {
  const { lang } = useParams();
  if (!isLang(lang)) return <Navigate to={`/${detectLang()}`} replace />;
  return (
    <I18nProvider lang={lang}>
      <DocumentTitle />
      <Outlet />
    </I18nProvider>
  );
}

function DocumentTitle() {
  const { t } = useI18n();
  useEffect(() => {
    document.title = t("site.name");
  }, [t]);
  return null;
}

function Lazy({ children }: { children: React.ReactNode }) {
  const fallback = <LoadingFallback />;
  return <Suspense fallback={fallback}>{children}</Suspense>;
}

function LoadingFallback() {
  const { t } = useI18n();
  return <p className="loading">{t("common.loading")}</p>;
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to={`/${detectLang()}`} replace />} />
      <Route path="/:lang" element={<LanguageRoot />}>
        <Route element={<Layout />}>
          <Route index element={<Home />} />
          {TOPICS.map((topic) => (
            <Route key={topic} path={topic} element={<TopicPage topic={topic} />} />
          ))}
          <Route path="data" element={<Datasets />} />
          <Route
            path="data/:name"
            element={
              <Lazy>
                <Explore />
              </Lazy>
            }
          />
          <Route
            path="sql"
            element={
              <Lazy>
                <Sql />
              </Lazy>
            }
          />
          <Route path="about" element={<About />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Route>
    </Routes>
  );
}
