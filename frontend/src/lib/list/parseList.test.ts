import { describe, expect, it } from "vitest";

import { parseShoppingText } from "./parseList";

const queries = (raw: string) => parseShoppingText(raw).map((item) => item.query);

describe("parseShoppingText", () => {
  it("reads one item per line", () => {
    expect(queries("חלב\nלחם\r\nביצים")).toEqual(["חלב", "לחם", "ביצים"]);
  });

  it("removes bullets, numbering and check marks", () => {
    expect(queries("- חלב\n• לחם\n* ביצים\n1. קפה\n2) תה\n✅ סוכר\n🛒 מלח")).toEqual([
      "חלב",
      "לחם",
      "ביצים",
      "קפה",
      "תה",
      "סוכר",
      "מלח",
    ]);
  });

  it("removes the prefix of copied WhatsApp messages", () => {
    const text = "[12:30, 31/10/2026] אמא: חלב\n[12:31, 31/10/2026] אמא: לחם";
    expect(queries(text)).toEqual(["חלב", "לחם"]);
  });

  it("removes the prefix when the date comes first", () => {
    expect(queries("[31/10/2026, 12:30:05] Mom: milk")).toEqual(["milk"]);
  });

  it("removes the prefix of an exported chat", () => {
    expect(queries("31/10/2026, 12:30 - Mom: milk")).toEqual(["milk"]);
    expect(queries("10/31/26, 9:05 PM - Mom: bread")).toEqual(["bread"]);
  });

  it("reads a multi-line message that follows a prefix", () => {
    const text = "[12:30, 31/10/2026] אמא: חלב\nלחם\nביצים";
    expect(queries(text)).toEqual(["חלב", "לחם", "ביצים"]);
  });

  it("ignores invisible direction marks", () => {
    expect(queries("‏[12:30, 31/10/2026] ‎אמא: ‫חלב‬")).toEqual(["חלב"]);
  });

  it("splits commas and semicolons", () => {
    expect(queries("חלב, לחם; ביצים + קפה")).toEqual(["חלב", "לחם", "ביצים", "קפה"]);
  });

  it("does not split a decimal comma", () => {
    expect(queries("1,5 ליטר חלב")).toEqual(["חלב"]);
  });

  it("separates quantity from the item but keeps it in the text", () => {
    expect(parseShoppingText('3 ק"ג עגבניות')).toEqual([
      { text: '3 ק"ג עגבניות', query: "עגבניות" },
    ]);
  });

  it.each([
    ["2 חלב", "חלב"],
    ["2 x חלב", "חלב"],
    ["2קילו עגבניות", "עגבניות"],
    ["חלב x2", "חלב"],
    ["חלב 2", "חלב"],
    ["לחם 3 יח'", "לחם"],
    ["חצי קילו גבינה", "גבינה"],
    ["שתי חבילות של פסטה", "פסטה"],
    ["שלושה בקבוקי קולה", "בקבוקי קולה"],
    ["2 kg tomatoes", "tomatoes"],
  ])("reads the quantity in %s", (text, query) => {
    expect(queries(text)).toEqual([query]);
  });

  it("does not eat a word that starts like a number", () => {
    expect(queries("חציל")).toEqual(["חציל"]);
    expect(queries("שמונים")).toEqual(["שמונים"]);
  });

  it("keeps a percentage, which is part of the product", () => {
    expect(queries("חלב 3%")).toEqual(["חלב 3%"]);
    expect(queries("קוטג' 5%")).toEqual(["קוטג' 5%"]);
  });

  it("removes request words", () => {
    expect(queries("תביא גם חלב בבקשה\nצריך לחם\nתקני ביצים")).toEqual(["חלב", "לחם", "ביצים"]);
  });

  it("skips greetings, headings and thanks", () => {
    expect(queries("היי!\nרשימת קניות:\nלסופר:\nחלב\nתודה רבה")).toEqual(["חלב"]);
  });

  it("skips media placeholders and links", () => {
    expect(queries("<Media omitted>\nimage omitted\nתמונה הושמטה\nhttps://example.com\nחלב")).toEqual(
      ["חלב"],
    );
  });

  it("removes duplicates", () => {
    expect(queries("חלב\nחלב\n2 חלב")).toEqual(["חלב"]);
  });

  it("returns nothing for empty text", () => {
    expect(parseShoppingText("  \n \n")).toEqual([]);
  });

  it("limits the list", () => {
    const text = Array.from({ length: 150 }, (_, index) => `פריט ${index}א`).join("\n");
    expect(parseShoppingText(text)).toHaveLength(100);
  });

  it("reads a realistic message end to end", () => {
    const text = [
      "[18:02, 30/10/2026] דנה: היי",
      "[18:02, 30/10/2026] דנה: רשימה לסופר:",
      "- 2 חלב",
      "- לחם, ביצים",
      "- 3 ק\"ג עגבניות",
      "- תביא גם טחינה",
      "תודה!",
    ].join("\n");

    expect(queries(text)).toEqual(["חלב", "לחם", "ביצים", "עגבניות", "טחינה"]);
  });
});
