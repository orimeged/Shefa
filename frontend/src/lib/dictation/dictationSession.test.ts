import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DictationStatus, SessionDependencies } from "./dictationSession";
import { DictationSession } from "./dictationSession";
import type { SegmentSink } from "./segmentRecorder";

const LOUD = 0.1;
const QUIET = 0.001;

interface Harness {
  sink: () => SegmentSink;
  session: DictationSession;
  statuses: DictationStatus[];
  transcripts: string[];
  finished: string[];
  failures: number[];
  rotations: boolean[];
  stops: boolean[];
  ended: { kept: number[]; dropped: number[] };
  micClosed: () => number;
  transportClosed: () => number;
  transcript: (segment: number, text: string) => void;
  failSegment: (segment: number) => void;
  setLevel: (level: number | null) => void;
}

function harness(overrides: Partial<SessionDependencies> = {}): Harness {
  let level: number | null = QUIET;
  let micClosed = 0;
  let transportClosed = 0;
  let transportEvents: Parameters<SessionDependencies["createTransport"]>[0] | undefined;
  let recorderSink: SegmentSink | undefined;
  const statuses: DictationStatus[] = [];
  const transcripts: string[] = [];
  const finished: string[] = [];
  const failures: number[] = [];
  const rotations: boolean[] = [];
  const stops: boolean[] = [];
  const ended = { kept: [] as number[], dropped: [] as number[] };

  const dependencies: SessionDependencies = {
    openMicrophone: async () => ({
      stream: {} as MediaStream,
      level: () => level,
      close: () => {
        micClosed += 1;
      },
    }),
    createTransport: (events) => {
      transportEvents = events;
      return {
        connect: async () => undefined,
        chunk: () => undefined,
        endSegment: (segment) => ended.kept.push(segment),
        discardSegment: (segment) => ended.dropped.push(segment),
        finish: async () => undefined,
        close: () => {
          transportClosed += 1;
        },
      };
    },
    createRecorder: (_stream, sink) => {
      recorderSink = sink;
      return {
        start: () => undefined,
        rotate: (keep) => rotations.push(keep),
        stop: async (keep) => {
          stops.push(keep);
        },
      };
    },
    ...overrides,
  };

  const session = new DictationSession(
    dependencies,
    {
      status: (status) => statuses.push(status),
      transcript: (text) => transcripts.push(text),
      speaking: () => undefined,
      failedSegments: (count) => failures.push(count),
      finished: (text) => finished.push(text),
    },
    () => Date.now(),
  );

  return {
    sink: () => recorderSink!,
    session,
    statuses,
    transcripts,
    finished,
    failures,
    rotations,
    stops,
    ended,
    micClosed: () => micClosed,
    transportClosed: () => transportClosed,
    transcript: (segment, text) => transportEvents?.transcript(segment, text),
    failSegment: (segment) => transportEvents?.failed(segment),
    setLevel: (next) => {
      level = next;
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("starting", () => {
  it("listens once the path to the server is open", async () => {
    const { session, statuses } = harness();

    await session.start();

    expect(statuses).toEqual(["starting", "listening"]);
  });

  it("is unavailable when the microphone is refused", async () => {
    const { session, statuses } = harness({
      openMicrophone: async () => {
        throw new DOMException("denied", "NotAllowedError");
      },
    });

    await session.start();

    expect(statuses.at(-1)).toBe("unavailable");
  });

  it("releases the microphone when the server can't take dictation", async () => {
    const test = harness({
      createTransport: () => ({
        connect: async () => {
          throw new Error("no engine");
        },
        chunk: () => undefined,
        endSegment: () => undefined,
        discardSegment: () => undefined,
        finish: async () => undefined,
        close: () => undefined,
      }),
    });

    await test.session.start();

    expect(test.statuses.at(-1)).toBe("unavailable");
    expect(test.micClosed()).toBe(1);
  });
});

describe("listening", () => {
  it("cuts a segment at a pause and keeps going", async () => {
    const { session, rotations, setLevel, statuses } = harness();
    await session.start();

    await vi.advanceTimersByTimeAsync(600);
    setLevel(LOUD);
    await vi.advanceTimersByTimeAsync(600);
    setLevel(QUIET);
    await vi.advanceTimersByTimeAsync(1000);

    expect(rotations).toEqual([true]);
    expect(statuses.at(-1)).toBe("listening");
  });

  it("drops a quiet stretch without sending it", async () => {
    const { session, rotations } = harness();
    await session.start();

    await vi.advanceTimersByTimeAsync(13_000);

    expect(rotations).toEqual([false]);
  });

  it("survives a long silence between items", async () => {
    const { session, statuses, finished } = harness();
    await session.start();

    await vi.advanceTimersByTimeAsync(40_000);

    expect(statuses.at(-1)).toBe("listening");
    expect(finished).toEqual([]);
  });

  it("orders phrases that return out of order", async () => {
    const { session, transcript, transcripts } = harness();
    await session.start();

    transcript(1, "לחם");
    transcript(0, "חלב");

    expect(transcripts.at(-1)).toBe("חלב\nלחם");
  });

  it("skips a segment that held no words", async () => {
    const { session, transcript, transcripts } = harness();
    await session.start();

    transcript(0, "");

    expect(transcripts).toEqual([]);
  });

  it("counts a phrase it couldn't read", async () => {
    const { session, failSegment, failures } = harness();
    await session.start();

    failSegment(0);
    failSegment(2);

    expect(failures).toEqual([1, 2]);
  });

  it("sends each kept segment and drops the rest", async () => {
    const { session, sink, ended } = harness();
    await session.start();

    sink().ended(0, true);
    sink().ended(1, false);

    expect(ended).toEqual({ kept: [0], dropped: [1] });
  });

  it("doesn't take unreadable loudness for silence", async () => {
    const { session, rotations, setLevel } = harness();
    await session.start();
    await vi.advanceTimersByTimeAsync(200);
    setLevel(null);

    await vi.advanceTimersByTimeAsync(20_000);
    expect(rotations).toEqual([]);

    setLevel(QUIET);
    await vi.advanceTimersByTimeAsync(100);

    expect(rotations).toEqual([true]);
  });

  it("keeps the audio if loudness never came back", async () => {
    const { session, setLevel, stops } = harness();
    await session.start();
    setLevel(null);
    await vi.advanceTimersByTimeAsync(5_000);

    await session.finish();

    expect(stops).toEqual([true]);
  });
});

describe("finishing", () => {
  it("delivers everything and releases the microphone", async () => {
    const test = harness();
    await test.session.start();
    test.transcript(0, "חלב");

    await test.session.finish();

    expect(test.finished).toEqual(["חלב"]);
    expect(test.statuses.slice(-2)).toEqual(["finishing", "idle"]);
    expect(test.micClosed()).toBeGreaterThan(0);
    expect(test.transportClosed()).toBe(1);
  });

  it("keeps a last phrase that was still being spoken", async () => {
    const { session, setLevel, stops } = harness();
    await session.start();
    await vi.advanceTimersByTimeAsync(600);
    setLevel(LOUD);
    await vi.advanceTimersByTimeAsync(400);

    await session.finish();

    expect(stops).toEqual([true]);
  });

  it("doesn't send a final stretch of silence", async () => {
    const { session, stops } = harness();
    await session.start();
    await vi.advanceTimersByTimeAsync(500);

    await session.finish();

    expect(stops).toEqual([false]);
  });

  it("doesn't ask for the last transcripts before the last audio is out", async () => {
    const order: string[] = [];
    let stopped: (() => void) | undefined;
    const test = harness({
      createTransport: () => ({
        connect: async () => undefined,
        chunk: () => undefined,
        endSegment: () => undefined,
        discardSegment: () => undefined,
        finish: async () => {
          order.push("transport finished");
        },
        close: () => undefined,
      }),
      createRecorder: () => ({
        start: () => undefined,
        rotate: () => undefined,
        stop: () =>
          new Promise<void>((resolve) => {
            stopped = () => {
              order.push("audio out");
              resolve();
            };
          }),
      }),
    });
    await test.session.start();

    const finishing = test.session.finish();
    await vi.advanceTimersByTimeAsync(50);
    expect(order).toEqual([]);
    stopped?.();
    await finishing;

    expect(order).toEqual(["audio out", "transport finished"]);
  });

  it("ends the session when something takes the microphone", async () => {
    const { session, sink, transcript, finished, statuses } = harness();
    await session.start();
    transcript(0, "חלב");

    sink().interrupted();
    await vi.advanceTimersByTimeAsync(0);

    expect(finished).toEqual(["חלב"]);
    expect(statuses.at(-1)).toBe("idle");
  });

  it("says so when nothing could be read at all", async () => {
    const { session, failSegment, statuses, finished } = harness();
    await session.start();
    failSegment(0);

    await session.finish();

    expect(finished).toEqual([]);
    expect(statuses.at(-1)).toBe("unavailable");
  });

  it("delivers what it has when only part failed", async () => {
    const { session, transcript, failSegment, statuses, finished } = harness();
    await session.start();
    transcript(0, "חלב");
    failSegment(1);

    await session.finish();

    expect(finished).toEqual(["חלב"]);
    expect(statuses.at(-1)).toBe("idle");
  });

  it("waits for transcripts still on their way", async () => {
    let answer: (() => void) | undefined;
    let events: Parameters<SessionDependencies["createTransport"]>[0] | undefined;
    const test = harness({
      createTransport: (handlers) => {
        events = handlers;
        return {
          connect: async () => undefined,
          chunk: () => undefined,
          endSegment: () => undefined,
          discardSegment: () => undefined,
          finish: () =>
            new Promise<void>((resolve) => {
              answer = resolve;
            }),
          close: () => undefined,
        };
      },
    });
    await test.session.start();

    const finishing = test.session.finish();
    await vi.advanceTimersByTimeAsync(0);
    events?.transcript(0, "חלב");
    answer?.();
    await finishing;

    expect(test.finished).toEqual(["חלב"]);
  });

  it("delivers nothing when nothing was said", async () => {
    const { session, finished } = harness();
    await session.start();

    await session.finish();

    expect(finished).toEqual([]);
  });

  it("ends a forgotten session by itself", async () => {
    const { session, finished, transcript, statuses } = harness();
    await session.start();
    transcript(0, "חלב");

    await vi.advanceTimersByTimeAsync(181_000);

    expect(finished).toEqual(["חלב"]);
    expect(statuses.at(-1)).toBe("idle");
  });
});

describe("cancelling", () => {
  it("drops the text and releases the microphone", async () => {
    const test = harness();
    await test.session.start();
    test.transcript(0, "חלב");

    test.session.cancel();

    expect(test.finished).toEqual([]);
    expect(test.statuses.at(-1)).toBe("idle");
    expect(test.micClosed()).toBe(1);
    expect(test.transportClosed()).toBe(1);
  });

  it("leaves no timer running", async () => {
    const test = harness();
    await test.session.start();
    test.session.cancel();
    const count = test.statuses.length;

    await vi.advanceTimersByTimeAsync(200_000);

    expect(test.statuses).toHaveLength(count);
  });

  it("stops a start still in progress", async () => {
    const test = harness();

    const starting = test.session.start();
    test.session.cancel();
    await starting;

    expect(test.statuses).not.toContain("listening");
  });

  it("doesn't leave the microphone on when cancelled mid-start", async () => {
    const test = harness();

    const starting = test.session.start();
    test.session.cancel();
    await starting;

    expect(test.micClosed()).toBe(1);
  });
});
