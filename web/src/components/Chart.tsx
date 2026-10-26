import { BarChart, LineChart } from "echarts/charts";
import {
  AriaComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TooltipComponent,
} from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { useEffect, useRef } from "react";
import { cssVar, useTheme } from "../lib/theme";

echarts.use([
  LineChart,
  BarChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  MarkLineComponent,
  AriaComponent,
  CanvasRenderer,
]);

export { echarts };

export interface ChartTheme {
  surface: string;
  surface2: string;
  seqLow: string;
  seqHigh: string;
  ink: string;
  ink2: string;
  muted: string;
  grid: string;
  axis: string;
  accent: string;
  series: string[];
  font: string;
}

export function readChartTheme(): ChartTheme {
  return {
    surface: cssVar("--surface"),
    surface2: cssVar("--surface-2"),
    seqLow: cssVar("--seq-low"),
    seqHigh: cssVar("--seq-high"),
    ink: cssVar("--ink"),
    ink2: cssVar("--ink-2"),
    muted: cssVar("--muted"),
    grid: cssVar("--grid"),
    axis: cssVar("--axis"),
    accent: cssVar("--accent"),
    series: Array.from({ length: 8 }, (_, index) => cssVar(`--series-${index + 1}`)),
    font: cssVar("--font"),
  };
}

export type OptionBuilder = (theme: ChartTheme) => echarts.EChartsCoreOption;

interface ChartProps {
  build: OptionBuilder;
  height?: number;
  /** Accessible description of what the chart shows. */
  label: string;
  className?: string;
}

export function Chart({ build, label, className = "chart", height }: ChartProps) {
  const element = useRef<HTMLDivElement>(null);
  const instance = useRef<echarts.ECharts | null>(null);
  const theme = useTheme();

  useEffect(() => {
    if (!element.current) return;
    const chart = echarts.init(element.current, null, { renderer: "canvas" });
    instance.current = chart;
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(element.current);
    return () => {
      observer.disconnect();
      chart.dispose();
      instance.current = null;
    };
  }, []);

  useEffect(() => {
    // `theme` is a dependency so colours are re-read from CSS after a toggle.
    void theme;
    instance.current?.setOption(build(readChartTheme()), { notMerge: true });
  }, [build, theme]);

  return (
    <div ref={element} className={className} role="img" aria-label={label} style={height ? { height } : undefined} />
  );
}

/** Shared chrome: recessive axes and grid, crosshair tooltip, legend only when needed. */
export function baseOption(theme: ChartTheme, seriesCount: number): echarts.EChartsCoreOption {
  return {
    animationDuration: 300,
    textStyle: { fontFamily: theme.font, color: theme.ink2 },
    color: theme.series,
    aria: { enabled: true },
    grid: { left: 8, right: 16, top: seriesCount > 1 ? 36 : 12, bottom: 8, containLabel: true },
    legend:
      seriesCount > 1
        ? {
            // One scrolling row: a wrapped legend would overlap the plot.
            type: "scroll",
            top: 0,
            left: 0,
            right: 0,
            pageIconColor: theme.ink2,
            pageTextStyle: { color: theme.muted },
            icon: "roundRect",
            itemWidth: 14,
            itemHeight: 4,
            textStyle: { color: theme.ink2, fontSize: 12 },
          }
        : undefined,
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "line", lineStyle: { color: theme.axis, width: 1 } },
      backgroundColor: theme.surface,
      borderColor: theme.grid,
      textStyle: { color: theme.ink, fontSize: 12 },
      confine: true,
    },
  };
}

const YEAR_MS = 365.25 * 24 * 3600 * 1000;

/** Yearly ticks labelled with the year: language-neutral and uncluttered. */
export function timeAxis(theme: ChartTheme) {
  return {
    type: "time",
    minInterval: YEAR_MS,
    axisLine: { lineStyle: { color: theme.axis } },
    axisTick: { show: false },
    axisLabel: {
      color: theme.muted,
      hideOverlap: true,
      formatter: (value: number) => String(new Date(value).getUTCFullYear()),
    },
    splitLine: { show: false },
  };
}

export function categoryAxis(theme: ChartTheme, data: string[], inverse = false) {
  return {
    type: "category",
    data,
    inverse,
    axisLine: { lineStyle: { color: theme.axis } },
    axisTick: { show: false },
    axisLabel: { color: theme.ink2, hideOverlap: true },
  };
}

export function valueAxis(theme: ChartTheme, formatter?: (value: number) => string, scale = false) {
  return {
    type: "value",
    scale,
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: { color: theme.muted, formatter },
    splitLine: { lineStyle: { color: theme.grid, width: 1 } },
  };
}

/** 2px line, no symbols except on hover, optional ~10% area wash. */
export function lineSeries(name: string, data: [string, number | null][], color: string, area = false) {
  return {
    type: "line",
    name,
    data,
    showSymbol: false,
    symbolSize: 8,
    connectNulls: false,
    lineStyle: { width: 2, color, cap: "round", join: "round" },
    itemStyle: { color },
    emphasis: { focus: "series" },
    areaStyle: area ? { color, opacity: 0.1 } : undefined,
  };
}

/** Bars capped at 24px with a 4px rounded data end and square baseline. */
export function barSeries(
  name: string,
  data: (number | null | { value: number | null; itemStyle?: object })[],
  color: string,
  horizontal = false,
) {
  return {
    type: "bar",
    name,
    data,
    barMaxWidth: 24,
    itemStyle: {
      color,
      borderRadius: horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0],
    },
  };
}
