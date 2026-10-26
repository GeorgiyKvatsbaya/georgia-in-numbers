import { MapChart as EchartsMap } from "echarts/charts";
import { VisualMapContinuousComponent } from "echarts/components";
import { useCallback, useEffect, useState } from "react";
import { useI18n } from "../i18n";
import { escapeHtml } from "../lib/charts";
import { fetchJson } from "../lib/data";
import { formatNumber } from "../lib/format";
import { Chart, echarts, type ChartTheme } from "./Chart";

// Registered here so only pages with maps download the map modules.
echarts.use([EchartsMap, VisualMapContinuousComponent]);

export type MapLayer = "regions" | "municipalities" | "tbilisi_districts";

interface GeoFeature {
  properties: { id: string; name_en: string; name_ka: string };
}

const registered = new Set<string>();

/** Features of `layer` once its boundaries are registered; null while another layer is shown. */
function useRegisteredMap(layer: MapLayer) {
  const [loaded, setLoaded] = useState<{ layer: MapLayer; features: GeoFeature[] } | null>(null);
  useEffect(() => {
    let active = true;
    fetchJson<{ features: GeoFeature[] }>(`geo/${layer}.json`).then((geojson) => {
      if (!registered.has(layer)) {
        echarts.registerMap(layer, geojson as never);
        registered.add(layer);
      }
      if (active) setLoaded({ layer, features: geojson.features });
    });
    return () => {
      active = false;
    };
  }, [layer]);
  // Never hand ECharts a layer whose boundaries are not registered yet (it throws).
  return loaded?.layer === layer ? loaded.features : null;
}

interface MapChartProps {
  layer: MapLayer;
  /** Values keyed by feature id (region / municipality code, or district name). */
  values: Map<string, number>;
  /** Localized display name for a feature id. */
  nameOf: (id: string, feature: GeoFeature["properties"]) => string;
  label: string;
  digits?: number;
  unit?: string;
}

/** Choropleth on a single-hue sequential ramp; areas without data stay neutral grey. */
export function MapChart({ layer, values, nameOf, label, digits = 0, unit = "" }: MapChartProps) {
  const { lang } = useI18n();
  const features = useRegisteredMap(layer);

  const build = useCallback(
    (theme: ChartTheme) => {
      const format = (value: unknown) => {
        const text = formatNumber(lang, value, { digits });
        return text === "—" ? text : `${text}${unit}`;
      };
      const props = new Map(features?.map((f) => [f.properties.id, f.properties]));
      const numbers = [...values.values()];
      const min = numbers.length ? Math.min(...numbers) : 0;
      const max = numbers.length ? Math.max(...numbers) : 1;
      return {
        textStyle: { fontFamily: theme.font, color: theme.ink2 },
        aria: { enabled: true },
        tooltip: {
          trigger: "item",
          backgroundColor: theme.surface,
          borderColor: theme.grid,
          textStyle: { color: theme.ink, fontSize: 12 },
          formatter: (params: { name: string; value: number }) => {
            const feature = props.get(params.name);
            const name = feature ? nameOf(params.name, feature) : params.name;
            const value = Number.isFinite(params.value) ? format(params.value) : "—";
            return `<strong>${escapeHtml(value)}</strong><br/>${escapeHtml(name)}`;
          },
        },
        visualMap: {
          type: "continuous",
          min,
          max,
          // End labels: high value at the right end, low at the left.
          text: [format(max), format(min)],
          textGap: 6,
          inRange: { color: [theme.seqLow, theme.seqHigh] },
          calculable: false,
          orient: "horizontal",
          left: 0,
          bottom: 0,
          itemWidth: 10,
          itemHeight: 140,
          textStyle: { color: theme.muted, fontSize: 11 },
        },
        series: [
          {
            type: "map",
            map: layer,
            nameProperty: "id",
            roam: false,
            selectedMode: false,
            layoutCenter: ["50%", "45%"],
            layoutSize: "100%",
            itemStyle: { areaColor: theme.surface2, borderColor: theme.surface, borderWidth: 1 },
            emphasis: {
              label: { show: false },
              itemStyle: { areaColor: theme.accent, borderColor: theme.surface },
            },
            label: { show: false },
            data: [...values].map(([name, value]) => ({ name, value })),
          },
        ],
      };
    },
    [features, values, nameOf, lang, digits, unit, layer],
  );

  if (!features) return <div className="map" aria-busy="true" />;
  // A new key per layer gives ECharts a fresh instance instead of morphing between maps.
  return <Chart key={layer} build={build} label={label} className="map" />;
}
