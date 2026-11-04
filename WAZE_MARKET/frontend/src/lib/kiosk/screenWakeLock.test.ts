import { describe, expect, it, vi } from "vitest";

import type { WakeLockHandle, WakeLockProvider } from "./screenWakeLock";
import { ScreenWakeLock } from "./screenWakeLock";

function fakeHandle() {
  const listeners: (() => void)[] = [];
  const handle: WakeLockHandle = {
    release: vi.fn(async () => undefined),
    addEventListener: (_type, listener) => {
      listeners.push(listener);
    },
  };
  return { handle, dropped: () => listeners.forEach((listener) => listener()) };
}

function provider(...handles: WakeLockHandle[]) {
  const request = vi.fn(async () => handles.shift()!);
  return { request } satisfies WakeLockProvider;
}

describe("ScreenWakeLock", () => {
  it("asks for the screen lock", async () => {
    const { handle } = fakeHandle();
    const wakeLock = provider(handle);

    await new ScreenWakeLock(wakeLock, () => true).acquire();

    expect(wakeLock.request).toHaveBeenCalledWith("screen");
  });

  it("does nothing where the browser has no wake lock", async () => {
    await expect(new ScreenWakeLock(undefined, () => true).acquire()).resolves.toBeUndefined();
  });

  it("doesn't ask again while it holds a lock", async () => {
    const { handle } = fakeHandle();
    const wakeLock = provider(handle);
    const lock = new ScreenWakeLock(wakeLock, () => true);

    await lock.acquire();
    await lock.acquire();

    expect(wakeLock.request).toHaveBeenCalledOnce();
  });

  it("doesn't send two requests at once", async () => {
    const { handle } = fakeHandle();
    const wakeLock = provider(handle);
    const lock = new ScreenWakeLock(wakeLock, () => true);

    await Promise.all([lock.acquire(), lock.acquire()]);

    expect(wakeLock.request).toHaveBeenCalledOnce();
  });

  it("takes the lock back after the browser drops it", async () => {
    const first = fakeHandle();
    const wakeLock = provider(first.handle, fakeHandle().handle);
    const lock = new ScreenWakeLock(wakeLock, () => true);

    await lock.acquire();
    first.dropped();
    await lock.acquire();

    expect(wakeLock.request).toHaveBeenCalledTimes(2);
  });

  it("waits until the page is visible", async () => {
    const { handle } = fakeHandle();
    const wakeLock = provider(handle);
    let visible = false;
    const lock = new ScreenWakeLock(wakeLock, () => visible);

    await lock.acquire();
    expect(wakeLock.request).not.toHaveBeenCalled();

    visible = true;
    await lock.acquire();
    expect(wakeLock.request).toHaveBeenCalledOnce();
  });

  it("survives a refusal and tries again later", async () => {
    const { handle } = fakeHandle();
    const request = vi
      .fn<WakeLockProvider["request"]>()
      .mockRejectedValueOnce(new Error("low battery"))
      .mockResolvedValueOnce(handle);
    const lock = new ScreenWakeLock({ request }, () => true);

    await lock.acquire();
    await lock.acquire();

    expect(request).toHaveBeenCalledTimes(2);
  });

  it("releases the lock when closed", async () => {
    const { handle } = fakeHandle();
    const lock = new ScreenWakeLock(provider(handle), () => true);

    await lock.acquire();
    lock.close();

    expect(handle.release).toHaveBeenCalledOnce();
  });

  it("releases a lock that arrives after closing", async () => {
    const { handle } = fakeHandle();
    const lock = new ScreenWakeLock(provider(handle), () => true);

    const pending = lock.acquire();
    lock.close();
    await pending;

    expect(handle.release).toHaveBeenCalledOnce();
  });
});
