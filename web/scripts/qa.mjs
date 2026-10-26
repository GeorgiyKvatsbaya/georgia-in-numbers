// QA pass: interactions, accessibility (axe), layout overflow, mobile, dark mode.
// Usage: SMOKE_URL=https://georgia-in-numbers.vercel.app node scripts/qa.mjs
import AxeBuilder from "@axe-core/playwright";
import { chromium } from "@playwright/test";

const BASE = process.env.SMOKE_URL ?? "http://localhost:4173";
const PAGES = ["", "/prices", "/prices/products", "/wages", "/labour", "/economy", "/trade", "/population", "/regions", "/data", "/about"];
const findings = [];
const note = (area, text) => findings.push(`[${area}] ${text}`);

const browser = await chromium.launch();

// 1. Accessibility + horizontal overflow, desktop and phone, light and dark.
for (const [label, viewport, scheme] of [["desktop", { width: 1280, height: 900 }, "light"], ["phone", { width: 390, height: 844 }, "dark"]]) {
  for (const path of PAGES) {
    const context = await browser.newContext({ viewport, colorScheme: scheme });
    const page = await context.newPage();
    await page.goto(`${BASE}/en${path}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (overflow > 1) note("layout", `${label} ${path || "/"}: page scrolls horizontally by ${overflow}px`);
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    for (const violation of results.violations) {
      const targets = violation.nodes.slice(0, 2).map((n) => n.target.join(" ")).join("; ");
      note("a11y", `${label} ${path || "/"}: ${violation.id} (${violation.impact}, ${violation.nodes.length}x) ${targets}`);
    }
    await context.close();
  }
}

// 2. Interactions.
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
// URL-driven state re-renders asynchronously, so wait for each expected change.
const until = async (check, what, timeout = 5000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await page.waitForTimeout(100);
  }
  note("filters", what);
  return false;
};

await page.goto(`${BASE}/en/wages`, { waitUntil: "networkidle" });
await page.getByRole("link", { name: "РУ" }).click();
await page.waitForURL("**/ru/wages");
if (!(await page.getByRole("heading", { name: "Зарплаты" }).count())) note("i18n", "language switch did not keep the page");

await page.goto(`${BASE}/en/prices`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Show table" }).first().click();
const tableRows = await page.locator(".data-table tbody tr").count();
if (tableRows < 10) note("table", `table view shows only ${tableRows} rows`);
const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download CSV" }).first().click()]);
const csv = await (await import("node:fs/promises")).readFile(await download.path(), "utf8");
if (!csv.startsWith("﻿period_start")) note("csv", `unexpected CSV header: ${csv.slice(0, 40)}`);

const before = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
await page.getByRole("button", { name: /light\/dark/ }).click();
const after = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
if (before === after) note("theme", "theme toggle did not change the background");
await page.reload({ waitUntil: "networkidle" });
const persisted = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
if (persisted !== after) note("theme", "theme choice not kept after reload");

await page.goto(`${BASE}/en/prices/products`, { waitUntil: "networkidle" });
await page.getByPlaceholder("Search products").fill("diesel");
const matches = await page.locator(".product-table tbody tr").count();
if (matches !== 1) note("products", `search 'diesel' shows ${matches} rows`);
await page.getByRole("button", { name: "Diesel fuel" }).click();
await until(async () => (await page.locator(".chip", { hasText: "Diesel fuel" }).count()) === 1, "Products: clicking a product did not add it to the chart");

await page.goto(`${BASE}/en/regions`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Municipalities" }).click();
await page.waitForTimeout(800);
const subtitle = await page.locator(".chart-card .subtitle").first().textContent();
if (!subtitle?.includes("Municipalities")) note("regions", `level switch failed: ${subtitle}`);

await page.goto(`${BASE}/en/nonexistent`, { waitUntil: "networkidle" });
if (!(await page.getByRole("heading", { name: "404" }).count())) note("routing", "unknown page has no 404");
await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
if (!/\/(en|ka|ru)$/.test(page.url())) note("routing", `root did not redirect to a language: ${page.url()}`);

// 3. Filters. URL-driven state re-renders asynchronously, so wait for each expected change.

const subtitleOf = async (index = 0) => (await page.locator(".chart-card .subtitle").nth(index).textContent()) ?? "";
const titleOf = async (index = 0) => (await page.locator(".chart-card h3").nth(index).textContent()) ?? "";

await page.goto(`${BASE}/en/prices`, { waitUntil: "networkidle" });
await page.getByRole("combobox", { name: "City", exact: true }).selectOption("Tbilisi");
await until(async () => (await titleOf(0)).includes("Tbilisi"), "Prices: city filter did not update the headline chart");
if (!page.url().includes("city=Tbilisi")) note("filters", "Prices: city not stored in the URL");
await page.getByRole("link", { name: "ქარ" }).click();
await page.waitForURL("**/ka/prices?**");
if (!page.url().includes("city=Tbilisi")) note("filters", "Prices: filter lost on language switch");
await page.goto(`${BASE}/en/prices?range=3y`, { waitUntil: "networkidle" });
await page.getByText("How to read this").first().click();
if (!(await page.locator(".chart-info[open] p").first().isVisible())) note("info", "explanation does not open");

await page.goto(`${BASE}/en/wages`, { waitUntil: "networkidle" });
await page.getByRole("combobox", { name: "Economic activity", exact: true }).selectOption("Education");
await until(async () => (await subtitleOf(0)).includes("Education"), "Wages: activity filter not applied");
await page.getByRole("combobox", { name: "Sex / sector", exact: true }).selectOption("Female");
await until(async () => (await subtitleOf(0)).includes("Female"), "Wages: sex filter not applied");

await page.goto(`${BASE}/en/trade`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "$ USD" }).click();
await until(async () => (await subtitleOf(0)).includes("USD"), "Trade: currency switch not applied");
await page.getByRole("button", { name: "Show table" }).first().click();
await until(async () => {
  const header = (await page.locator(".data-table thead").first().textContent()) ?? "";
  return header.includes("million USD") && !header.includes("million GEL");
}, "Trade: USD table still shows GEL column headers");
await page.getByRole("button", { name: "Annual" }).click();
await until(async () => page.url().includes("freq=annual"), "Trade: frequency not applied");

await page.goto(`${BASE}/en/prices/products`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Diesel fuel" }).click();
await until(async () => (await page.locator(".chip").count()) === 2, "Products: comparing two products failed");
await page.getByRole("button", { name: "Index, Jan 2020 = 100" }).click();
await until(async () => (await subtitleOf(0)).includes("January 2020"), "Products: index mode not applied");
await page.getByRole("combobox", { name: "Sort", exact: true }).selectOption("up");
await until(async () => (await page.locator(".product-table tbody tr td button").first().textContent()) === "Diesel fuel", "Products: sort by biggest increase does not start with Diesel fuel");

await page.goto(`${BASE}/en/labour`, { waitUntil: "networkidle" });
await page.getByRole("combobox", { name: "Region", exact: true }).selectOption("Imereti");
await until(async () => (await page.locator(".chart-card h3", { hasText: "Imereti" }).count()) > 0, "Jobs: region trend not updated");

await page.goto(`${BASE}/en/population`, { waitUntil: "networkidle" });
await page.getByRole("combobox", { name: "Year", exact: true }).selectOption("2000");
await until(async () => (await subtitleOf(2)).includes("2000"), "Population: year filter not applied to the pyramid");

await page.goto(`${BASE}/en/economy`, { waitUntil: "networkidle" });
await page.getByRole("combobox", { name: "Sector", exact: true }).selectOption("F");
await until(async () => (await subtitleOf(1)).includes("Construction"), "Economy: sector filter not applied");

await page.goto(`${BASE}/en/regions?level=municipality`, { waitUntil: "networkidle" });
await page.waitForTimeout(800);
await page.getByRole("combobox", { name: "Area", exact: true }).selectOption({ label: "Gori" });
await until(async () => (await page.locator(".chart-card h3", { hasText: "Gori" }).count()) > 0, "Regions: area trend not updated");

for (const error of errors) note("js", error);
await browser.close();

console.log(findings.length ? findings.join("\n") : "No findings");
