import { describe, expect, it } from "vitest";

import type { PushFacts } from "./push";
import { applicationServerKey, pushStateOf } from "./push";

const ready: PushFacts = {
  supported: true,
  ios: false,
  installed: false,
  serverKey: "key",
  permission: "default",
  subscribed: false,
};

describe("pushStateOf", () => {
  it("offers to turn alerts on where it can", () => {
    expect(pushStateOf(ready)).toBe("off");
    expect(pushStateOf({ ...ready, permission: "granted", subscribed: true })).toBe("on");
  });

  it("asks an iPhone in Safari to install first", () => {
    expect(pushStateOf({ ...ready, supported: false, ios: true })).toBe("install-first");
    expect(pushStateOf({ ...ready, supported: false, ios: true, installed: true })).toBe("unsupported");
    expect(pushStateOf({ ...ready, supported: false })).toBe("unsupported");
  });

  it("says so when the server can't push or the phone refused", () => {
    expect(pushStateOf({ ...ready, serverKey: null })).toBe("server-off");
    expect(pushStateOf({ ...ready, permission: "denied" })).toBe("denied");
  });

  it("doesn't call a subscription without permission on", () => {
    expect(pushStateOf({ ...ready, subscribed: true, permission: "default" })).toBe("off");
  });
});

describe("applicationServerKey", () => {
  it("decodes base64url without padding", () => {
    expect([...applicationServerKey("AQID-_8")]).toEqual([1, 2, 3, 251, 255]);
  });

  it("keeps a whole P-256 public key", () => {
    const key = "B" + "A".repeat(86);
    expect(applicationServerKey(key)).toHaveLength(65);
  });
});
