import { describe, expect, it } from "vitest";

import {
  buildMobileUrl,
  isReachableFromPhone,
  parseCategoryIds,
  resolvePublicOrigin,
} from "./shareUrl";

const localhost = {
  protocol: "http:",
  hostname: "localhost",
  port: "5173",
  origin: "http://localhost:5173",
};
const onNetwork = {
  protocol: "http:",
  hostname: "192.168.1.20",
  port: "5173",
  origin: "http://192.168.1.20:5173",
};

describe("resolvePublicOrigin", () => {
  it("swaps localhost for the network address and keeps the port", () => {
    expect(resolvePublicOrigin({ lanIp: "192.168.68.69", location: localhost })).toBe(
      "http://192.168.68.69:5173",
    );
  });

  it("uses the page's own origin when it is already on the network", () => {
    expect(resolvePublicOrigin({ lanIp: "192.168.68.69", location: onNetwork })).toBe(
      "http://192.168.1.20:5173",
    );
  });

  it("prefers a configured origin and drops its trailing slash", () => {
    expect(
      resolvePublicOrigin({
        configuredOrigin: "https://demo.example.com/",
        lanIp: "192.168.68.69",
        location: localhost,
      }),
    ).toBe("https://demo.example.com");
  });

  it("falls back to localhost when no network address is known", () => {
    expect(resolvePublicOrigin({ lanIp: null, location: localhost })).toBe("http://localhost:5173");
  });
});

describe("isReachableFromPhone", () => {
  it("rejects local origins only", () => {
    expect(isReachableFromPhone("http://localhost:5173")).toBe(false);
    expect(isReachableFromPhone("http://127.0.0.1:5173")).toBe(false);
    expect(isReachableFromPhone("http://192.168.1.20:5173")).toBe(true);
  });
});

describe("buildMobileUrl", () => {
  it("builds the mobile address with plain commas", () => {
    expect(buildMobileUrl("http://10.0.0.5:4173", ["dairy", "pasta"], "he")).toBe(
      "http://10.0.0.5:4173/mobile?categories=dairy,pasta",
    );
  });

  it("gives the plain address for the entrance's static QR code", () => {
    expect(buildMobileUrl("http://10.0.0.5:4173", [], "he")).toBe("http://10.0.0.5:4173/mobile");
    expect(buildMobileUrl("http://10.0.0.5:4173", [], "en")).toBe(
      "http://10.0.0.5:4173/mobile?lang=en",
    );
  });

  it("carries a non-default language", () => {
    expect(buildMobileUrl("http://10.0.0.5:4173", ["dairy"], "en")).toBe(
      "http://10.0.0.5:4173/mobile?categories=dairy&lang=en",
    );
  });
});

describe("parseCategoryIds", () => {
  it("splits, trims and removes duplicates", () => {
    expect(parseCategoryIds("dairy, pasta,dairy,,")).toEqual(["dairy", "pasta"]);
  });

  it("returns nothing for a missing value", () => {
    expect(parseCategoryIds(null)).toEqual([]);
  });
});
