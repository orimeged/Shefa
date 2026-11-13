import { describe, expect, it } from "vitest";

import { signSpecs } from "./signs";

describe("signSpecs", () => {
  it("opens the shopper's app at the entrance, and says where at each shelf", () => {
    const signs = signSpecs("https://shefa.example/", ["חלב וביצים", "פירות"], true);

    expect(signs.map((sign) => sign.url)).toEqual([
      "https://shefa.example/mobile",
      "https://shefa.example/mobile?at=%D7%97%D7%9C%D7%91+%D7%95%D7%91%D7%99%D7%A6%D7%99%D7%9D",
      "https://shefa.example/mobile?at=%D7%A4%D7%99%D7%A8%D7%95%D7%AA",
    ]);
    expect(new URL(signs[1]!.url).searchParams.get("at")).toBe("חלב וביצים");
  });

  it("leaves the entrance out when asked", () => {
    expect(signSpecs("http://192.168.1.5:4173", ["פירות"], false).map((sign) => sign.shelf)).toEqual(["פירות"]);
  });
});
