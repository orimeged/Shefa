import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../../api/client";
import type { NotFoundReport } from "../../api/types";
import { newUuid, NotFoundQueue } from "./notFoundQueue";

function report(id: string): NotFoundReport {
  return {
    event_id: id,
    store_id: "demo",
    session_id: "s",
    item_query: "טחינה",
    category_id: "spreads",
    x_coord: 6,
    y_coord: 13,
    timestamp: "2026-11-01T10:00:00.000Z",
  };
}

class MemoryStorage {
  readonly values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

const offline = () => Promise.reject(new TypeError("Failed to fetch"));

let storage: MemoryStorage;
let sent: string[];
const delivered = async (entry: NotFoundReport) => {
  sent.push(entry.event_id);
};

beforeEach(() => {
  vi.useFakeTimers();
  storage = new MemoryStorage();
  sent = [];
});

afterEach(() => {
  vi.useRealTimers();
});

describe("newUuid", () => {
  it("makes a version 4 UUID, which the server requires", () => {
    expect(newUuid()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("doesn't repeat", () => {
    expect(new Set(Array.from({ length: 1000 }, newUuid)).size).toBe(1000);
  });
});

describe("NotFoundQueue", () => {
  it("sends a report right away", async () => {
    const queue = new NotFoundQueue(delivered, storage);

    queue.add(report("a"));
    await vi.advanceTimersByTimeAsync(0);

    expect(sent).toEqual(["a"]);
  });

  it("keeps a report the network dropped, through a reload", async () => {
    new NotFoundQueue(offline, storage).add(report("a"));
    await vi.advanceTimersByTimeAsync(0);

    await new NotFoundQueue(delivered, storage).flush();

    expect(sent).toEqual(["a"]);
  });

  it("forgets a report once delivered", async () => {
    new NotFoundQueue(delivered, storage).add(report("a"));
    await vi.advanceTimersByTimeAsync(0);

    await new NotFoundQueue(delivered, storage).flush();

    expect(sent).toEqual(["a"]);
  });

  it("retries by itself, because a weak signal fires no online event", async () => {
    let online = false;
    const queue = new NotFoundQueue(
      (entry) => (online ? delivered(entry) : offline()),
      storage,
    );
    queue.add(report("a"));
    await vi.advanceTimersByTimeAsync(0);

    online = true;
    await vi.advanceTimersByTimeAsync(15_000);

    expect(sent).toEqual(["a"]);
  });

  it("waits longer after each failure, up to a limit", async () => {
    const attempts: number[] = [];
    const queue = new NotFoundQueue(() => {
      attempts.push(Date.now());
      return offline();
    }, storage);

    queue.add(report("a"));
    await vi.advanceTimersByTimeAsync(40 * 60_000);

    const gaps = attempts.slice(1).map((time, index) => time - attempts[index]!);
    expect(gaps.slice(0, 3)).toEqual([15_000, 30_000, 60_000]);
    expect(Math.max(...gaps)).toBe(5 * 60_000);
  });

  it("keeps the order and stops at the first network failure", async () => {
    const attempted: string[] = [];
    const queue = new NotFoundQueue((entry) => {
      attempted.push(entry.event_id);
      return offline();
    }, storage);

    queue.add(report("a"));
    await vi.advanceTimersByTimeAsync(0);
    queue.add(report("b"));
    await vi.advanceTimersByTimeAsync(0);

    expect(attempted).toEqual(["a", "a"]);
  });

  it("drops a report the server refused, or it would block the rest", async () => {
    const queue = new NotFoundQueue((entry) => {
      if (entry.event_id === "bad") {
        return Promise.reject(new ApiError(422, "off the map"));
      }
      return delivered(entry);
    }, storage);

    queue.add(report("bad"));
    queue.add(report("good"));
    await vi.advanceTimersByTimeAsync(0);

    expect(sent).toEqual(["good"]);
  });

  it.each([500, 503, 408, 429])("keeps a report after a %i", async (status) => {
    let failing = true;
    const queue = new NotFoundQueue(
      (entry) => (failing ? Promise.reject(new ApiError(status, "later")) : delivered(entry)),
      storage,
    );

    queue.add(report("a"));
    await vi.advanceTimersByTimeAsync(0);
    failing = false;
    await queue.flush();

    expect(sent).toEqual(["a"]);
  });

  it("doesn't send a report twice at once", async () => {
    let release: (() => void) | undefined;
    const queue = new NotFoundQueue(
      (entry) =>
        new Promise<void>((resolve) => {
          sent.push(entry.event_id);
          release = resolve;
        }),
      storage,
    );

    queue.add(report("a"));
    await queue.flush();
    await queue.flush();
    release?.();
    await vi.advanceTimersByTimeAsync(0);

    expect(sent).toEqual(["a"]);
  });

  it("delivers what arrived while it was sending", async () => {
    let release: (() => void) | undefined;
    const queue = new NotFoundQueue(
      (entry) =>
        new Promise<void>((resolve) => {
          sent.push(entry.event_id);
          release = resolve;
        }),
      storage,
    );

    queue.add(report("a"));
    queue.add(report("b"));
    release?.();
    await vi.advanceTimersByTimeAsync(0);

    expect(sent).toEqual(["a", "b"]);
  });

  it("caps what it holds, dropping the oldest", async () => {
    const queue = new NotFoundQueue(offline, storage);

    for (let index = 0; index < 205; index += 1) {
      queue.add(report(`r${index}`));
    }
    await vi.advanceTimersByTimeAsync(0);

    const stored = JSON.parse(storage.values.get("not-found-queue:v1")!) as NotFoundReport[];
    expect(stored).toHaveLength(200);
    expect(stored[0]?.event_id).toBe("r5");
  });

  it("works with no storage at all", async () => {
    const queue = new NotFoundQueue(delivered, null);

    queue.add(report("a"));
    await vi.advanceTimersByTimeAsync(0);

    expect(sent).toEqual(["a"]);
  });

  it("survives a full disk", async () => {
    storage.setItem = () => {
      throw new DOMException("full", "QuotaExceededError");
    };
    const queue = new NotFoundQueue(delivered, storage);

    queue.add(report("a"));
    await vi.advanceTimersByTimeAsync(0);

    expect(sent).toEqual(["a"]);
  });

  it("ignores corrupt storage", () => {
    storage.setItem("not-found-queue:v1", "{not json");

    expect(() => new NotFoundQueue(delivered, storage)).not.toThrow();
  });

  it("stops retrying when asked", async () => {
    let attempts = 0;
    const queue = new NotFoundQueue(() => {
      attempts += 1;
      return offline();
    }, storage);
    queue.add(report("a"));
    await vi.advanceTimersByTimeAsync(0);

    queue.stop();
    await vi.advanceTimersByTimeAsync(60 * 60_000);

    expect(attempts).toBe(1);
  });
});
