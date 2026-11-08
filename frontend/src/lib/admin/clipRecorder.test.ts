import { describe, expect, it, vi } from "vitest";

import type { RecorderLike } from "../dictation/segmentRecorder";
import { ClipRecorder, formatClock } from "./clipRecorder";

function fakeRecorder() {
  const recorder: RecorderLike = {
    state: "inactive",
    ondataavailable: null,
    onstop: null,
    start: () => {
      recorder.state = "recording";
    },
    stop: () => {
      recorder.state = "inactive";
      recorder.onstop?.();
    },
  };
  return recorder;
}

const blob = (text: string) => new Blob([text]);

describe("ClipRecorder", () => {
  it("joins every chunk into one clip of the recorded type", async () => {
    const recorder = fakeRecorder();
    const onClip = vi.fn();
    const clip = new ClipRecorder(() => recorder, "audio/webm;codecs=opus", onClip);

    clip.start();
    recorder.ondataavailable?.({ data: blob("ab") });
    recorder.ondataavailable?.({ data: blob("cd") });
    clip.stop();

    const [result] = onClip.mock.calls[0]! as [Blob];
    expect(await result.text()).toBe("abcd");
    expect(result.type).toBe("audio/webm;codecs=opus");
  });

  it("skips empty chunks", () => {
    const recorder = fakeRecorder();
    const onClip = vi.fn();
    const clip = new ClipRecorder(() => recorder, "audio/mp4", onClip);

    clip.start();
    recorder.ondataavailable?.({ data: blob("") });
    clip.stop();

    expect(onClip).toHaveBeenCalledWith(null);
  });

  it("hands over the audio when recording stops by itself", () => {
    const recorder = fakeRecorder();
    const onClip = vi.fn();
    const clip = new ClipRecorder(() => recorder, "audio/mp4", onClip);

    clip.start();
    recorder.ondataavailable?.({ data: blob("ab") });
    recorder.stop();

    expect(onClip.mock.calls[0]![0]).toBeInstanceOf(Blob);
  });

  it("throws away a discarded recording", () => {
    const recorder = fakeRecorder();
    const onClip = vi.fn();
    const clip = new ClipRecorder(() => recorder, "audio/mp4", onClip);

    clip.start();
    recorder.ondataavailable?.({ data: blob("ab") });
    clip.discard();

    expect(onClip).toHaveBeenCalledWith(null);
  });

  it("doesn't stop a recorder twice", () => {
    const recorder = fakeRecorder();
    const stop = vi.spyOn(recorder, "stop");
    const clip = new ClipRecorder(() => recorder, "audio/mp4", vi.fn());

    clip.start();
    clip.stop();
    clip.stop();

    expect(stop).toHaveBeenCalledTimes(1);
  });
});

describe("formatClock", () => {
  it("shows minutes and two-digit seconds", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(7.9)).toBe("0:07");
    expect(formatClock(120)).toBe("2:00");
  });
});
