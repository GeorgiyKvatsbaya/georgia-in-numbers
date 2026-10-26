import { useMemo, type ReactNode } from "react";
import { useI18n, type MessageKey } from "../i18n";
import { toRows, useDashboard, type Dashboard, type Row } from "../lib/data";

export function DashboardPage({
  topic,
  children,
}: {
  topic: string;
  children: (dashboard: Dashboard) => ReactNode;
}) {
  const { t } = useI18n();
  const { data, error } = useDashboard(topic);
  return (
    <>
      <div className="page-head">
        <h1>{t(`nav.${topic}` as MessageKey)}</h1>
        <p className="lede">{t(`topic.${topic}` as MessageKey)}</p>
      </div>
      {error && <p className="notice">{t("common.error")}</p>}
      {!data && !error && <p className="loading">{t("common.loading")}</p>}
      {data && children(data)}
    </>
  );
}

/** Rows of a named series, memoised so chart builders keep a stable identity. */
export function useRows(dashboard: Dashboard | null, name: string): Row[] {
  return useMemo(() => toRows(dashboard?.series[name]), [dashboard, name]);
}

export function maxPeriod(rows: Row[]): string {
  return rows.reduce((max, row) => (String(row.period_start) > max ? String(row.period_start) : max), "");
}
