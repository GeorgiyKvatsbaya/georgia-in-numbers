import { describe, expect, it } from "vitest";
import { DICTIONARIES, LANGS, translate } from ".";

describe("i18n dictionaries", () => {
  const english = Object.keys(DICTIONARIES.en).sort();

  for (const lang of LANGS) {
    it(`${lang} has exactly the English keys`, () => {
      expect(Object.keys(DICTIONARIES[lang]).sort()).toEqual(english);
    });

    it(`${lang} keeps every {placeholder}`, () => {
      for (const key of english) {
        const placeholders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort();
        const source = DICTIONARIES.en[key as keyof typeof DICTIONARIES.en];
        const target = DICTIONARIES[lang][key as keyof typeof DICTIONARIES.en];
        expect(placeholders(target), `${lang}:${key}`).toEqual(placeholders(source));
        expect(target.trim(), `${lang}:${key} is empty`).not.toBe("");
      }
    });
  }

  it("interpolates variables", () => {
    expect(translate("en", "common.rows", { count: 12 })).toBe("12 rows");
    expect(translate("ru", "common.rows", { count: 12 })).toBe("12 строк");
  });
});
