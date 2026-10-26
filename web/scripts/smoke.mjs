// Smoke test: every route in every language renders without browser errors.
// Usage: npm run build && npx vite preview --port 4173 & npm run smoke
import { chromium } from "@playwright/test";

const BASE = process.env.SMOKE_URL ?? "http://localhost:4173";
const LANGS = ["en", "ka", "ru"];
const ROUTES = [
  { path: "", expect: ".kpi-value" },
  { path: "/prices", expect: ".chart canvas" },
  { path: "/prices/products", expect: ".product-table tbody tr" },
  { path: "/wages", expect: ".chart canvas" },
  { path: "/labour", expect: ".chart canvas" },
  { path: "/economy", expect: ".chart canvas" },
  { path: "/trade", expect: ".chart canvas" },
  { path: "/population", expect: ".chart canvas" },
  { path: "/regions", expect: ".map canvas" },
  { path: "/data", expect: ".card h3" },
  { path: "/about", expect: "article h1" },
];

const browser = await chromium.launch();
const failures = [];
for (const lang of LANGS) {
  for (const route of ROUTES) {
    const url = `${BASE}/${lang}${route.path}`;
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => message.type() === "error" && errors.push(message.text()));
    try {
      await page.goto(url, { waitUntil: "networkidle" });
      await page.waitForSelector(route.expect, { timeout: 10000 });
      if ((await page.getAttribute("html", "lang")) !== lang) errors.push(`html lang is not ${lang}`);
    } catch (error) {
      errors.push(String(error.message ?? error).split("\n")[0]);
    }
    if (errors.length) failures.push(`${url}: ${errors.join(" | ")}`);
    await page.close();
  }
}
await browser.close();
if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log(`OK: ${LANGS.length * ROUTES.length} pages rendered without errors`);
