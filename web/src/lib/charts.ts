import {
  barSeries,
  baseOption,
  categoryAxis,
  lineSeries,
  timeAxis,
  valueAxis,
  type ChartTheme,
  type OptionBuilder,
} from "../components/Chart";
import type { Lang } from "../i18n";
import type { Row } from "./data";
import { formatNumber, formatPeriod, type PeriodType } from "./format";

export interface Series {
  name: string;
  points: [string, number | null][];
}

/** Group rows into one series per value of `by` (or a single series when omitted). */
export function toSeries(rows: Row[], value: string, by?: string, name = ""): Series[] {
  const groups = new Map<string, [string, number | null][]>();
  for (const row of rows) {
    const key = by ? String(row[by]) : name;
    if (!groups.has(key)) groups.set(key, []);
    const raw = row[value];
    groups.get(key)!.push([String(row.period_start), raw === null || raw === undefined ? null : Number(raw)]);
  }
  return [...groups].map(([seriesName, points]) => ({ name: seriesName, points }));
}

export function latestBy<T extends Row>(rows: T[], key = "period_start"): T[] {
  const latest = rows.reduce((max, row) => (String(row[key]) > max ? String(row[key]) : max), "");
  return rows.filter((row) => String(row[key]) === latest);
}

interface TimeSeriesOptions {
  lang: Lang;
  series: Series[];
  period: PeriodType;
  digits?: number;
  unit?: string;
  area?: boolean;
  /** Reference line, e.g. 0 for growth rates or 100 for an index base. */
  baseline?: number;
  /** Keep series colours stable when a filter hides some series. */
  colorIndex?: (name: string, index: number) => number;
  /** Translate series names for legend and tooltip. */
  label?: (name: string) => string;
}

export function timeSeriesChart(options: TimeSeriesOptions): OptionBuilder {
  const { lang, series, period, digits = 1, unit = "", area = false, baseline, colorIndex, label } = options;
  const format = (value: unknown) => {
    const text = formatNumber(lang, value, { digits });
    return text === "—" ? text : `${text}${unit}`;
  };
  return (theme: ChartTheme) => {
    const base = baseOption(theme, series.length);
    return {
      ...base,
      tooltip: {
        ...(base.tooltip as object),
        valueFormatter: format,
        axisPointer: { type: "line", lineStyle: { color: theme.axis, width: 1 } },
        formatter: tooltipFormatter(lang, period, format),
      },
      xAxis: timeAxis(theme),
      yAxis: valueAxis(theme, (value: number) => axisNumber(lang, value), true),
      series: series.map((item, index) => {
        const color = theme.series[(colorIndex ? colorIndex(item.name, index) : index) % theme.series.length];
        const line = lineSeries(label ? label(item.name) : item.name, item.points, color, area && series.length === 1);
        if (index === 0 && baseline !== undefined) {
          return {
            ...line,
            markLine: {
              silent: true,
              symbol: "none",
              label: { show: false },
              lineStyle: { color: theme.axis, width: 1, type: "solid" },
              data: [{ yAxis: baseline }],
            },
          };
        }
        return line;
      }),
    };
  };
}

function tooltipFormatter(lang: Lang, period: PeriodType, format: (value: unknown) => string) {
  return (params: unknown) => {
    const items = (Array.isArray(params) ? params : [params]) as {
      value: [string, number | null];
      seriesName: string;
      color: string;
    }[];
    if (!items.length) return "";
    const header = formatPeriod(lang, items[0].value[0], period);
    // Values lead, series names follow; keys are short line strokes (dataviz guidance).
    const rows = items
      .filter((item) => item.value[1] !== null && item.value[1] !== undefined)
      .map(
        (item) =>
          `<div style="display:flex;align-items:center;gap:8px;margin-top:2px">` +
          `<span style="display:inline-block;width:12px;height:2px;background:${item.color}"></span>` +
          `<strong>${escapeHtml(format(item.value[1]))}</strong>` +
          `<span style="opacity:.75">${escapeHtml(item.seriesName)}</span></div>`,
      )
      .join("");
    return `<div style="font-weight:600;margin-bottom:2px">${escapeHtml(header)}</div>${rows}`;
  };
}

/** Axis tick: compact (1.8K) with up to two decimals, so small ranges keep distinct labels. */
export function axisNumber(lang: Lang, value: number): string {
  return formatNumber(lang, value, { digits: 2, compact: true });
}

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

interface BarOptions {
  lang: Lang;
  items: { label: string; value: number | null }[];
  digits?: number;
  unit?: string;
  /** Colour negative bars with the diverging pole instead of the series colour. */
  diverging?: boolean;
  highlight?: string;
}

/** Ranked horizontal bars: one colour, labelled values, longest first. */
export function rankedBarChart(options: BarOptions): OptionBuilder {
  const { lang, items, digits = 1, unit = "", diverging = false, highlight } = options;
  const sorted = [...items].filter((item) => item.value !== null).sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  const format = (value: unknown) => {
    const text = formatNumber(lang, value, { digits });
    return text === "—" ? text : `${text}${unit}`;
  };
  return (theme: ChartTheme) => {
    const negative = cssColor("--diverging-neg") || theme.series[7];
    return {
      ...baseOption(theme, 1),
      grid: { left: 8, right: 56, top: 4, bottom: 4, containLabel: true },
      tooltip: { ...(baseOption(theme, 1).tooltip as object), trigger: "item", valueFormatter: format },
      xAxis: { ...valueAxis(theme, (value: number) => axisNumber(lang, value)), splitLine: { show: false }, axisLabel: { show: false } },
      yAxis: categoryAxis(theme, sorted.map((item) => item.label), true),
      series: [
        {
          ...barSeries(
            "",
            sorted.map((item) => {
              const value = item.value ?? 0;
              const color =
                diverging && value < 0
                  ? negative
                  : highlight && item.label !== highlight
                    ? theme.series[0] + "99"
                    : theme.series[0];
              return {
                value,
                itemStyle: { color, borderRadius: value < 0 ? [4, 0, 0, 4] : [0, 4, 4, 0] },
              };
            }),
            theme.series[0],
            true,
          ),
          label: {
            show: true,
            position: "right",
            color: theme.ink2,
            fontSize: 11,
            formatter: (params: { value: number }) => format(params.value),
          },
        },
      ],
    };
  };
}

function cssColor(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

interface ColumnBarOptions {
  lang: Lang;
  points: [string, number | null][];
  period: PeriodType;
  digits?: number;
  unit?: string;
  /** Points to draw lighter (e.g. preliminary figures). */
  muted?: (date: string) => boolean;
}

/** Vertical bars over time; negative values take the diverging pole. */
export function columnChart(options: ColumnBarOptions): OptionBuilder {
  const { lang, points, period, digits = 1, unit = "", muted } = options;
  const format = (value: unknown) => {
    const text = formatNumber(lang, value, { digits });
    return text === "—" ? text : `${text}${unit}`;
  };
  return (theme: ChartTheme) => {
    const negative = cssColor("--diverging-neg") || theme.series[7];
    return {
      ...baseOption(theme, 1),
      tooltip: {
        ...(baseOption(theme, 1).tooltip as object),
        trigger: "item",
        formatter: (params: { name: string; value: number }) =>
          `<strong>${escapeHtml(format(params.value))}</strong><br/>${escapeHtml(formatPeriod(lang, params.name, period))}`,
      },
      xAxis: { ...categoryAxis(theme, points.map(([date]) => date)), axisLabel: { color: theme.muted, hideOverlap: true, formatter: (value: string) => formatPeriod(lang, value, "annual") } },
      yAxis: valueAxis(theme, (value: number) => axisNumber(lang, value)),
      series: [
        barSeries(
          "",
          points.map(([date, value]) => ({
            value,
            itemStyle: {
              color: (value ?? 0) < 0 ? negative : theme.series[0],
              opacity: muted?.(date) ? 0.55 : 1,
              borderRadius: (value ?? 0) < 0 ? [0, 0, 4, 4] : [4, 4, 0, 0],
            },
          })),
          theme.series[0],
        ),
      ],
    };
  };
}
