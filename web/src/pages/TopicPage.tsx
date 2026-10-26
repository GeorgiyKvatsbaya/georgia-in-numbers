import { lazy, Suspense } from "react";
import type { Topic } from "../components/Layout";
import { useI18n } from "../i18n";

// Each dashboard is its own chunk; maps and large series load only where used.
const DASHBOARDS = {
  prices: lazy(() => import("../dashboards/Prices")),
  wages: lazy(() => import("../dashboards/Wages")),
  labour: lazy(() => import("../dashboards/Labour")),
  economy: lazy(() => import("../dashboards/Economy")),
  trade: lazy(() => import("../dashboards/Trade")),
  population: lazy(() => import("../dashboards/Population")),
  regions: lazy(() => import("../dashboards/Regions")),
} satisfies Record<Topic, unknown>;

export function TopicPage({ topic }: { topic: Topic }) {
  const { t } = useI18n();
  const Dashboard = DASHBOARDS[topic];
  return (
    <Suspense fallback={<p className="loading">{t("common.loading")}</p>}>
      <Dashboard />
    </Suspense>
  );
}
