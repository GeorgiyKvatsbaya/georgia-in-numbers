import { describe, expect, it } from "vitest";
import { toCsv } from "./csv";
import { toRows } from "./data";
import { formatNumber, formatPercent, formatPeriod } from "./format";

describe("formatting", () => {
  it("formats numbers per locale", () => {
    expect(formatNumber("en", 1234.56)).toBe("1,234.6");
    expect(formatNumber("ru", 1234.56).replace(/\s/g, " ")).toBe("1 234,6");
    expect(formatNumber("en", null)).toBe("—");
    expect(formatPercent("en", 2.06, 1, true)).toBe("+2.1%");
  });

  it("formats periods by type and language", () => {
    expect(formatPeriod("en", "2026-04-01", "quarter")).toBe("Q2 2026");
    expect(formatPeriod("ru", "2026-04-01", "quarter")).toBe("II кв. 2026");
    expect(formatPeriod("ka", "2026-04-01", "quarter")).toBe("2026 II კვ.");
    expect(formatPeriod("en", "2025-01-01", "annual")).toBe("2025");
    expect(formatPeriod("en", "2026-09-01", "month")).toBe("Sept 2026");
  });
});

describe("data helpers", () => {
  it("turns columnar series into rows", () => {
    expect(toRows({ columns: ["a", "b"], rows: [[1, "x"], [2, "y"]] })).toEqual([
      { a: 1, b: "x" },
      { a: 2, b: "y" },
    ]);
  });

  it("escapes CSV fields", () => {
    expect(toCsv([{ name: 'Water supply, "sewerage"', value: 1 }])).toBe(
      'name,value\r\n"Water supply, ""sewerage""",1\r\n',
    );
  });
});
