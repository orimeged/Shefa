import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { IdleTimer } from "./idleTimer";

describe("IdleTimer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires once the timeout passes with no activity", () => {
    const onIdle = vi.fn();
    const timer = new IdleTimer(30_000, onIdle);

    timer.activity();
    vi.advanceTimersByTime(29_999);
    expect(onIdle).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onIdle).toHaveBeenCalledOnce();
  });

  it("starts the wait over on every touch", () => {
    const onIdle = vi.fn();
    const timer = new IdleTimer(30_000, onIdle);

    timer.activity();
    vi.advanceTimersByTime(20_000);
    timer.activity();
    vi.advanceTimersByTime(20_000);

    expect(onIdle).not.toHaveBeenCalled();
  });

  it("keeps firing while the screen stays untouched", () => {
    const onIdle = vi.fn();
    const timer = new IdleTimer(30_000, onIdle);

    timer.activity();
    vi.advanceTimersByTime(90_000);

    expect(onIdle).toHaveBeenCalledTimes(3);
  });

  it("goes quiet when stopped", () => {
    const onIdle = vi.fn();
    const timer = new IdleTimer(30_000, onIdle);

    timer.activity();
    timer.stop();
    vi.advanceTimersByTime(90_000);

    expect(onIdle).not.toHaveBeenCalled();
  });
});
