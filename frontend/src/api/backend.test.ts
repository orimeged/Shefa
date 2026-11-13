import { describe, expect, it } from "vitest";

import { apiUrl } from "./backend";

describe("apiUrl", () => {
  it("stays relative with no backend set, for the proxy to forward", () => {
    expect(apiUrl("/api/v1/stores/demo/map", "")).toBe("/api/v1/stores/demo/map");
  });

  it("goes to the backend's own domain when one is set", () => {
    expect(apiUrl("/api/v1/stores/demo/map", "https://shefa-api.onrender.com")).toBe(
      "https://shefa-api.onrender.com/api/v1/stores/demo/map",
    );
  });

  it("doesn't double a trailing slash someone typed into the setting", () => {
    expect(apiUrl("/health", "https://api.example.com/ ")).toBe("https://api.example.com/health");
  });
});
