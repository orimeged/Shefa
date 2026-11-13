import { describe, expect, it } from "vitest";

import { strings } from "../../i18n/strings";
import { formatAgo } from "./time";

const NOW = Date.parse("2026-11-12T18:00:00Z");
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

describe("formatAgo", () => {
  it("counts minutes, then hours, then days", () => {
    expect(formatAgo(ago(12), strings.en, NOW)).toBe("12 min ago");
    expect(formatAgo(ago(0), strings.en, NOW)).toBe("just now");
    expect(formatAgo(ago(150), strings.en, NOW)).toBe("3 hours ago");
    expect(formatAgo(ago(26 * 60), strings.en, NOW)).toBe("yesterday");
    expect(formatAgo(ago(3 * 24 * 60), strings.en, NOW)).toBe("3 days ago");
  });

  it("speaks Hebrew, duals included", () => {
    expect(formatAgo(ago(12), strings.he, NOW)).toBe("לפני 12 דק׳");
    expect(formatAgo(ago(60), strings.he, NOW)).toBe("לפני שעה");
    expect(formatAgo(ago(120), strings.he, NOW)).toBe("לפני שעתיים");
    expect(formatAgo(ago(300), strings.he, NOW)).toBe("לפני 5 שעות");
    expect(formatAgo(ago(26 * 60), strings.he, NOW)).toBe("אתמול");
    expect(formatAgo(ago(2 * 24 * 60), strings.he, NOW)).toBe("לפני יומיים");
  });

  it("treats a phone clock a little ahead as now", () => {
    expect(formatAgo(new Date(NOW + 30_000).toISOString(), strings.he, NOW)).toBe("עכשיו");
  });
});
