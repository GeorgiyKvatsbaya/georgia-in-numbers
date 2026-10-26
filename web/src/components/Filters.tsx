import { useCallback, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { useI18n } from "../i18n";
import type { Row } from "../lib/data";

/**
 * Filter state kept in the URL (?range=5y&city=Tbilisi), so a filtered view can be shared
 * and survives a language switch.
 */
export function useParamState<T extends string = string>(key: string, fallback: NoInfer<T>): [T, (value: T) => void] {
  const [params, setParams] = useSearchParams();
  const value = (params.get(key) as T | null) ?? fallback;
  const setValue = useCallback(
    (next: T) =>
      setParams(
        (current) => {
          const updated = new URLSearchParams(current);
          if (next === fallback) updated.delete(key);
          else updated.set(key, next);
          return updated;
        },
        { replace: true },
      ),
    [key, fallback, setParams],
  );
  return [value, setValue];
}

export const RANGES = ["3y", "5y", "10y", "all"] as const;
export type Range = (typeof RANGES)[number];

/** First period start to show for a range (ISO date), or "" for everything. */
export function rangeStart(range: Range, today = new Date()): string {
  if (range === "all") return "";
  const years = Number.parseInt(range, 10);
  return `${today.getFullYear() - years}-01-01`;
}

export function inRange<T extends Row>(rows: T[], start: string, key = "period_start"): T[] {
  return start ? rows.filter((row) => String(row[key]) >= start) : rows;
}

export function useRange(fallback: Range = "10y") {
  const [range, setRange] = useParamState<Range>("range", fallback);
  return { range: RANGES.includes(range) ? range : fallback, setRange, start: rangeStart(range) };
}

export function FilterBar({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="filter-row" role="group" aria-label={t("filters.label")}>
      {children}
    </div>
  );
}

export function RangeFilter({ range, setRange }: { range: Range; setRange: (range: Range) => void }) {
  const { t } = useI18n();
  return (
    <Segmented
      label={t("filters.period")}
      value={range}
      onChange={setRange}
      options={RANGES.map((value) => ({ value, label: t(`filters.range.${value}`) }))}
    />
  );
}

export function Segmented<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="filter">
      <span className="filter-label">{label}</span>
      <div className="segmented" role="group" aria-label={label}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            className={option.value === value ? "active" : undefined}
            aria-pressed={option.value === value}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function SelectFilter({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="filter">
      <span className="filter-label">{label}</span>
      <select className="select" aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
