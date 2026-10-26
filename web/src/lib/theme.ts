import { useEffect, useState } from "react";

export type Theme = "light" | "dark";

const STORAGE_KEY = "gin-theme";
const media = () => window.matchMedia("(prefers-color-scheme: dark)");

export function currentTheme(): Theme {
  const explicit = document.documentElement.dataset.theme;
  if (explicit === "light" || explicit === "dark") return explicit;
  return media().matches ? "dark" : "light";
}

export function setTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Not persisting the choice is fine.
  }
  window.dispatchEvent(new Event("gin-theme"));
}

/** Re-renders when the theme changes, via the toggle or the OS setting. */
export function useTheme(): Theme {
  const [theme, setState] = useState<Theme>(currentTheme);
  useEffect(() => {
    const update = () => setState(currentTheme());
    const query = media();
    query.addEventListener("change", update);
    window.addEventListener("gin-theme", update);
    return () => {
      query.removeEventListener("change", update);
      window.removeEventListener("gin-theme", update);
    };
  }, []);
  return theme;
}

/** Read a CSS custom property from the root (chart colours live in styles.css). */
export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
