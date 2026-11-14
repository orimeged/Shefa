import { describe, expect, it } from "vitest";

import { agorotToField, formatShekels, parseShekels } from "./money";

/** Intl puts direction marks and non-breaking spaces around the sign; compare what's read. */
function plain(text: string): string {
  return text.replace(/[‎‏  ]/g, " ").replace(/\s+/g, " ").trim();
}

describe("formatShekels", () => {
  it("shows a shelf price to the agora", () => {
    expect(plain(formatShekels(710, "en"))).toBe("₪7.10");
    expect(plain(formatShekels(710, "he"))).toContain("7.10");
    expect(plain(formatShekels(710, "he"))).toContain("₪");
  });

  it("rounds a total to whole shekels", () => {
    expect(plain(formatShekels(95_749, "en", true))).toBe("₪957");
    expect(plain(formatShekels(123_456_00, "en", true))).toBe("₪123,456");
  });
});

describe("parseShekels", () => {
  it("reads what a manager types", () => {
    expect(parseShekels("7.1")).toBe(710);
    expect(parseShekels("7.10")).toBe(710);
    expect(parseShekels("₪ 12")).toBe(1200);
    expect(parseShekels("1,299.90")).toBe(129_990);
    expect(parseShekels("0.05")).toBe(5);
  });

  it("is null for an empty field and NaN for nonsense", () => {
    expect(parseShekels("  ")).toBeNull();
    expect(parseShekels("abc")).toBeNaN();
    expect(parseShekels("7.105")).toBeNaN();
    expect(parseShekels("-3")).toBeNaN();
  });

  it("round-trips through an edit field", () => {
    expect(agorotToField(710)).toBe("7.10");
    expect(agorotToField(null)).toBe("");
    expect(parseShekels(agorotToField(4490))).toBe(4490);
  });
});
