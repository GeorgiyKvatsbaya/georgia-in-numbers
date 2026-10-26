import type { Row } from "./data";

function escape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(rows: Row[], columns?: string[]): string {
  const header = columns ?? (rows[0] ? Object.keys(rows[0]) : []);
  const lines = [header.map(escape).join(",")];
  for (const row of rows) lines.push(header.map((column) => escape(row[column])).join(","));
  return lines.join("\r\n") + "\r\n";
}

export function downloadCsv(filename: string, rows: Row[], columns?: string[]) {
  // BOM so Excel opens Georgian/Cyrillic text as UTF-8.
  const blob = new Blob(["﻿", toCsv(rows, columns)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
