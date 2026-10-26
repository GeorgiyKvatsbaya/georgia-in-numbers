import { LOCALES, type Lang } from "../i18n";

export type PeriodType = "month" | "quarter" | "annual";

const ROMAN = ["I", "II", "III", "IV"];
// Some browsers (notably Chromium builds with trimmed ICU data) lack Georgian locale data.
const KA_MONTHS = ["იან", "თებ", "მარ", "აპრ", "მაი", "ივნ", "ივლ", "აგვ", "სექ", "ოქტ", "ნოე", "დეკ"];

function supports(locale: string): boolean {
  try {
    return new Intl.DateTimeFormat(locale).resolvedOptions().locale.startsWith(locale.slice(0, 2));
  } catch {
    return false;
  }
}

const georgianSupported = supports("ka-GE");

/** Locale for numbers: Georgian grouping matches Russian (space thousands, comma decimals). */
export function numberLocale(lang: Lang): string {
  return lang === "ka" && !georgianSupported ? "ru-RU" : LOCALES[lang];
}

interface NumberOptions {
  digits?: number;
  signed?: boolean;
  compact?: boolean;
}

export function formatNumber(lang: Lang, value: unknown, options: NumberOptions = {}): string {
  if (value === null || value === undefined || value === "") return "—";
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  const { digits = 1, signed = false, compact = false } = options;
  return new Intl.NumberFormat(numberLocale(lang), {
    maximumFractionDigits: digits,
    minimumFractionDigits: compact ? 0 : digits,
    notation: compact ? "compact" : "standard",
    signDisplay: signed ? "exceptZero" : "auto",
  }).format(number);
}

export function formatPercent(lang: Lang, value: unknown, digits = 1, signed = false): string {
  const text = formatNumber(lang, value, { digits, signed });
  return text === "—" ? text : `${text}%`;
}

function parseDate(iso: string): Date {
  // Period starts are calendar dates; build them in UTC so time zones never shift the month.
  const [year, month, day] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(year, (month || 1) - 1, day || 1));
}

export function formatPeriod(lang: Lang, iso: string | null | undefined, type: PeriodType): string {
  if (!iso) return "—";
  const date = parseDate(iso);
  const year = date.getUTCFullYear();
  if (type === "annual") return String(year);
  if (type === "quarter") {
    const quarter = Math.floor(date.getUTCMonth() / 3);
    if (lang === "ru") return `${ROMAN[quarter]} кв. ${year}`;
    if (lang === "ka") return `${year} ${ROMAN[quarter]} კვ.`;
    return `Q${quarter + 1} ${year}`;
  }
  if (lang === "ka" && !georgianSupported) return `${KA_MONTHS[date.getUTCMonth()]}. ${year}`;
  return new Intl.DateTimeFormat(LOCALES[lang], {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export function formatDate(lang: Lang, iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (lang === "ka" && !georgianSupported) {
    return `${date.getDate()} ${KA_MONTHS[date.getMonth()]}. ${date.getFullYear()}`;
  }
  return new Intl.DateTimeFormat(LOCALES[lang], { dateStyle: "medium" }).format(date);
}

/** Finest period granularity present in a dataset. */
export function finestPeriod(types: string[] | undefined): PeriodType {
  if (types?.includes("month")) return "month";
  if (types?.includes("quarter")) return "quarter";
  return "annual";
}
