import { createContext, useContext, useMemo, type ReactNode } from "react";
import en from "./en.json";
import ka from "./ka.json";
import ru from "./ru.json";

export const LANGS = ["en", "ka", "ru"] as const;
export type Lang = (typeof LANGS)[number];
export type MessageKey = keyof typeof en;

export const DICTIONARIES: Record<Lang, Record<MessageKey, string>> = { en, ka, ru };
export const LANG_NAMES: Record<Lang, string> = { en: "EN", ka: "ქარ", ru: "РУ" };
export const LOCALES: Record<Lang, string> = { en: "en-GB", ka: "ka-GE", ru: "ru-RU" };

export function isLang(value: string | undefined): value is Lang {
  return LANGS.includes(value as Lang);
}

/** Preferred language: stored choice, then the browser's languages, then English. */
export function detectLang(): Lang {
  try {
    const stored = localStorage.getItem("gin-lang");
    if (isLang(stored ?? undefined)) return stored as Lang;
  } catch {
    // Storage can be unavailable (private mode); fall through to the browser setting.
  }
  for (const tag of navigator.languages ?? [navigator.language]) {
    const base = tag.toLowerCase().split("-")[0];
    if (isLang(base)) return base;
  }
  return "en";
}

export function translate(lang: Lang, key: MessageKey, vars?: Record<string, string | number>) {
  const template = DICTIONARIES[lang][key] ?? DICTIONARIES.en[key] ?? key;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}

interface I18n {
  lang: Lang;
  locale: string;
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
  /** Pick the current language from a {en, ka, ru} object, falling back to English. */
  pick: (value: Partial<Record<Lang, string>> | null | undefined) => string;
}

const I18nContext = createContext<I18n | null>(null);

export function I18nProvider({ lang, children }: { lang: Lang; children: ReactNode }) {
  const value = useMemo<I18n>(
    () => ({
      lang,
      locale: LOCALES[lang],
      t: (key, vars) => translate(lang, key, vars),
      pick: (localized) => localized?.[lang] || localized?.en || "",
    }),
    [lang],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const context = useContext(I18nContext);
  if (!context) throw new Error("useI18n must be used inside I18nProvider");
  return context;
}
