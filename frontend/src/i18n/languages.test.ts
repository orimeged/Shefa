import { describe, expect, it } from "vitest";

import { buildMobileUrl } from "../lib/shareUrl";
import { NAME_TRANSLATIONS, translatedName } from "./names";
import { shopperArabic } from "./shopper.ar";
import { shopperRussian } from "./shopper.ru";
import { LANGUAGE_NAMES, SHOPPER_LANGUAGES, strings } from "./strings";

/** Arguments a string function might take: a number, a name, a side. */
function sample(fn: (...args: never[]) => string): string {
  const args = Array.from({ length: fn.length }, (_, index) => (index === 1 ? "left" : index % 2 === 0 ? 3 : "חלב"));
  return (fn as (...args: unknown[]) => string)(...args);
}

describe("the shoppers' four languages", () => {
  it("are all offered, each named in itself", () => {
    expect(SHOPPER_LANGUAGES).toEqual(["he", "ar", "ru", "en"]);
    expect(LANGUAGE_NAMES.ar).toBe("العربية");
    expect(LANGUAGE_NAMES.ru).toBe("Русский");
  });

  it("read in the right direction", () => {
    expect(strings.ar.direction).toBe("rtl");
    expect(strings.ru.direction).toBe("ltr");
  });

  it("translate the same strings in Arabic and Russian", () => {
    expect(Object.keys(shopperArabic).sort()).toEqual(Object.keys(shopperRussian).sort());
  });

  it("never print undefined or a stray template", () => {
    for (const table of [shopperArabic, shopperRussian]) {
      for (const [key, value] of Object.entries(table)) {
        const text = typeof value === "function" ? sample(value as (...args: never[]) => string) : String(value);
        expect(text, key).not.toMatch(/undefined|\$\{/);
      }
    }
  });

  it("fall back to English for what only staff see", () => {
    expect(strings.ar.lostSalesTitle).toBe(strings.en.lostSalesTitle);
    expect(strings.ru.adminTitle).toBe(strings.en.adminTitle);
  });

  it("are carried to the phone by the kiosk's code", () => {
    expect(buildMobileUrl("https://shefa.example", ["dairy"], "ar")).toBe("https://shefa.example/mobile?categories=dairy&lang=ar");
    expect(buildMobileUrl("https://shefa.example", [], "he")).toBe("https://shefa.example/mobile");
  });
});

describe("department names", () => {
  it("translate the catalog's departments", () => {
    expect(translatedName("מוצרי חלב וביצים", "ar")).toBe("ألبان وبيض");
    expect(translatedName("לחם ומאפים", "ru")).toBe("Хлеб и выпечка");
  });

  it("leave a name nobody translated for the English fallback", () => {
    expect(translatedName("קומבוצה", "ar")).toBeUndefined();
  });

  it("have both languages for every name", () => {
    for (const [hebrew, names] of Object.entries(NAME_TRANSLATIONS)) {
      expect(names.ar, hebrew).toMatch(/[؀-ۿ]/);
      expect(names.ru, hebrew).toMatch(/[Ѐ-ӿ]/);
    }
  });
});
