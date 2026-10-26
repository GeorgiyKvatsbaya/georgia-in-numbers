import { Link } from "react-router-dom";

interface KpiTileProps {
  label: string;
  value: string;
  meta: string;
  delta?: { text: string; direction: "up" | "down" | "flat"; good?: boolean };
  trend?: number[];
  to?: string;
}

/** Stat tile: label, value, period, optional delta and a lightweight SVG sparkline. */
export function KpiTile({ label, value, meta, delta, trend, to }: KpiTileProps) {
  const body = (
    <div className="kpi">
      <span className="kpi-label">{label}</span>
      <span className="kpi-value">{value}</span>
      <span className="kpi-meta">
        {meta}
        {delta && (
          <>
            {" · "}
            <span className={`kpi-delta ${delta.good === undefined ? "" : delta.good ? "up" : "down"}`}>
              {delta.direction === "up" ? "▲" : delta.direction === "down" ? "▼" : "•"} {delta.text}
            </span>
          </>
        )}
      </span>
      {trend && trend.length > 1 && <Sparkline values={trend} />}
    </div>
  );
  return to ? (
    <Link to={to} className="card" aria-label={`${label}: ${value}`}>
      {body}
    </Link>
  ) : (
    <div className="card">{body}</div>
  );
}

export function Sparkline({ values, width = 240, height = 44 }: { values: number[]; width?: number; height?: number }) {
  const finite = values.filter(Number.isFinite);
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const span = max - min || 1;
  const step = width / (values.length - 1);
  const y = (value: number) => height - 4 - ((value - min) / span) * (height - 8);
  const path = values.map((value, index) => `${index ? "L" : "M"}${(index * step).toFixed(1)},${y(value).toFixed(1)}`).join("");
  const last = values[values.length - 1];
  return (
    <svg className="spark" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true" width="100%" height={height}>
      <path d={path} fill="none" stroke="var(--muted)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      <circle cx={width} cy={y(last)} r="3.5" fill="var(--accent)" stroke="var(--surface)" strokeWidth="2" />
    </svg>
  );
}
