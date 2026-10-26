import { useState, type ReactNode } from "react";
import { useI18n } from "../i18n";
import { downloadCsv } from "../lib/csv";
import type { Row } from "../lib/data";
import { formatNumber, formatPeriod, type PeriodType } from "../lib/format";
import { useColumnLabels, useLabels } from "../lib/labels";
import { Chart, type OptionBuilder } from "./Chart";
import { SourceNote } from "./SourceNote";

interface ChartCardProps {
  title: string;
  subtitle?: string;
  build?: OptionBuilder;
  /** Rows behind the chart: shown in the table view and downloaded as CSV. */
  rows: Row[];
  columns: string[];
  period?: PeriodType;
  sources: string[];
  filename: string;
  tall?: boolean;
  wide?: boolean;
  /** Explicit chart height in px, e.g. for long ranked lists. */
  chartHeight?: number;
  /** Plain-language explanation shown under "How to read this". */
  info?: string;
  /** Custom visual (e.g. a map) instead of `build`. */
  children?: ReactNode;
  controls?: ReactNode;
}

export function ChartCard(props: ChartCardProps) {
  const { title, subtitle, build, rows, columns, period = "month", sources, filename, tall, wide, chartHeight, info, children, controls } = props;
  const { lang, t } = useI18n();
  const label = useLabels();
  const columnLabel = useColumnLabels();
  const [showTable, setShowTable] = useState(false);

  const cell = (column: string, value: unknown) => {
    if (column === "period_start") return formatPeriod(lang, String(value), period);
    if (typeof value === "number") return formatNumber(lang, value, { digits: Number.isInteger(value) ? 0 : 2 });
    if (typeof value === "boolean") return value ? "✓" : "";
    return label(value);
  };

  return (
    <section className={`card chart-card${tall ? " tall" : ""}`} style={wide ? { gridColumn: "1 / -1" } : undefined}>
      <h3>{title}</h3>
      {subtitle && <p className="subtitle">{subtitle}</p>}
      {info && (
        <details className="chart-info">
          <summary>{t("common.howToRead")}</summary>
          <p>{info}</p>
        </details>
      )}
      {controls && <div className="chart-controls">{controls}</div>}
      {showTable ? (
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                {columns.map((column) => (
                  <th key={column} scope="col">
                    {columnLabel(column)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={index}>
                  {columns.map((column) => (
                    <td key={column} className={typeof row[column] === "number" ? "num" : undefined}>
                      {cell(column, row[column])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        children ?? (build && <Chart build={build} label={title} height={chartHeight} />)
      )}
      <div className="chart-foot">
        <SourceNote objects={sources} />
        <div className="actions">
          <button type="button" className="button ghost" onClick={() => setShowTable(!showTable)}>
            {showTable ? t("common.showChart") : t("common.showTable")}
          </button>
          <button type="button" className="button ghost" onClick={() => downloadCsv(filename, rows, columns)}>
            {t("common.downloadCsv")}
          </button>
        </div>
      </div>
    </section>
  );
}
