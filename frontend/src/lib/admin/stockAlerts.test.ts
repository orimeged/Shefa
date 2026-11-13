import { describe, expect, it } from "vitest";

import type { NotFoundReportRow } from "../../api/types";
import {
  ALERT_THRESHOLD,
  countAlerts,
  formatReportTime,
  needsAttention,
  reportRowKey,
} from "./stockAlerts";

function row(times_reported: number): NotFoundReportRow {
  return {
    item_query: "לחם",
    category_id: "bakery",
    catalog_category_id: 2,
    category_name: "לחם ומאפים",
    category_name_en: "Bakery",
    times_reported,
    last_reported_at: "2026-11-01T10:30:00Z",
    unit_price_agorot: 740,
    price_basis: "product",
    value_agorot: 740 * times_reported,
    shelf: "לחם ופיתות",
  };
}

describe("needsAttention", () => {
  it("flags an item from three reports up", () => {
    expect(ALERT_THRESHOLD).toBe(3);
    expect(needsAttention(row(3))).toBe(true);
    expect(needsAttention(row(9))).toBe(true);
  });

  it("leaves one or two reports alone", () => {
    expect(needsAttention(row(2))).toBe(false);
  });
});

describe("countAlerts", () => {
  it("counts only the flagged rows", () => {
    expect(countAlerts([row(7), row(3), row(2), row(1)])).toBe(2);
  });

  it("is zero for an empty report", () => {
    expect(countAlerts([])).toBe(0);
  });
});

describe("reportRowKey", () => {
  it("tells apart the same words under two categories", () => {
    expect(reportRowKey(row(1))).not.toBe(reportRowKey({ ...row(1), category_id: "snacks" }));
  });

  it("tells apart no category from one named after the item", () => {
    const named = { ...row(1), category_id: "null", item_query: "x" };

    expect(reportRowKey({ ...named, category_id: null })).not.toBe(reportRowKey(named));
  });

  it("stays the same for the same row with a new count", () => {
    expect(reportRowKey(row(1))).toBe(reportRowKey(row(9)));
  });
});

describe("formatReportTime", () => {
  it("shows the store's local time, not UTC", () => {
    expect(formatReportTime("2026-11-01T10:30:00Z", "en", "Asia/Jerusalem")).toContain("12:30");
  });

  it("names the month in the active language", () => {
    expect(formatReportTime("2026-11-01T10:30:00Z", "en", "UTC")).toContain("Nov");
    expect(formatReportTime("2026-11-01T10:30:00Z", "he", "UTC")).toContain("בנוב");
  });
});
