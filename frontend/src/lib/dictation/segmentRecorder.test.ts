import { beforeEach, describe, expect, it } from "vitest";

import type { RecorderLike } from "./segmentRecorder";
import { pickMimeType, SegmentRecorder } from "./segmentRecorder";

class FakeRecorder implements RecorderLike {
  state = "inactive";
  ondataavailable: RecorderLike["ondataavailable"] = null;
  onstop: RecorderLike["onstop"] = null;

  start() {
    this.state = "recording";
  }

  stop() {
    this.state = "inactive";
    this.emit("tail");
    this.onstop?.();
  }

  emit(text: string) {
    this.ondataavailable?.({ data: new Blob([text]) });
  }
}

let recorders: FakeRecorder[];
let chunks: { segment: number; size: number }[];
let ended: { segment: number; keep: boolean }[];
let interruptions: number;

function create(failOn?: number) {
  return new SegmentRecorder(
    () => {
      const running = recorders.filter((recorder) => recorder.state === "recording").length;
      if (failOn !== undefined && recorders.length === failOn && running > 0) {
        throw new DOMException("one at a time", "NotSupportedError");
      }
      const recorder = new FakeRecorder();
      recorders.push(recorder);
      return recorder;
    },
    "audio/webm",
    {
      chunk: (segment, data) => chunks.push({ segment, size: data.size }),
      ended: (segment, keep) => ended.push({ segment, keep }),
      interrupted: () => {
        interruptions += 1;
      },
    },
  );
}

beforeEach(() => {
  recorders = [];
  chunks = [];
  ended = [];
  interruptions = 0;
});

describe("pickMimeType", () => {
  it("prefers opus in webm", () => {
    expect(pickMimeType(() => true)).toBe("audio/webm;codecs=opus");
  });

  it("falls back to mp4 on iOS", () => {
    expect(pickMimeType((type) => type === "audio/mp4")).toBe("audio/mp4");
  });

  it("reports when nothing is supported", () => {
    expect(pickMimeType(() => false)).toBeNull();
  });
});

describe("SegmentRecorder", () => {
  it("delivers chunks as they're produced", () => {
    const recorder = create();

    recorder.start();
    recorders[0]?.emit("abc");

    expect(chunks).toEqual([{ segment: 0, size: 3 }]);
  });

  it("gives every segment its own recorder, so each has a header", () => {
    const recorder = create();

    recorder.start();
    recorder.rotate(true);
    recorder.rotate(true);

    expect(recorders).toHaveLength(3);
  });

  it("starts the next recorder before stopping the old one", () => {
    const states: string[] = [];
    const recorder = new SegmentRecorder(
      () => {
        states.push(recorders[0]?.state ?? "none");
        const next = new FakeRecorder();
        recorders.push(next);
        return next;
      },
      "audio/webm",
      { chunk: () => undefined, ended: () => undefined, interrupted: () => undefined },
    );

    recorder.start();
    recorder.rotate(true);

    expect(states).toEqual(["none", "recording"]);
    expect(recorders[0]?.state).toBe("inactive");
  });

  it("keeps a late chunk with its own segment", () => {
    const recorder = create();

    recorder.start();
    recorder.rotate(true);
    recorders[1]?.emit("xx");

    expect(chunks).toEqual([
      { segment: 0, size: 4 },
      { segment: 1, size: 2 },
    ]);
  });

  it("reports whether a segment is worth keeping", async () => {
    const recorder = create();

    recorder.start();
    recorder.rotate(false);
    recorder.rotate(true);
    await recorder.stop(false);

    expect(ended).toEqual([
      { segment: 0, keep: false },
      { segment: 1, keep: true },
      { segment: 2, keep: false },
    ]);
  });

  it("isn't stopped until the last audio has arrived", async () => {
    const recorder = create();
    recorder.start();
    const last = recorders[0]!;
    last.stop = () => {
      last.state = "inactive";
    };

    let stopped = false;
    const stopping = recorder.stop(true).then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);

    last.emit("tail");
    last.onstop?.();
    await stopping;

    expect(chunks).toEqual([{ segment: 0, size: 4 }]);
    expect(ended).toEqual([{ segment: 0, keep: true }]);
  });

  it("waits for a recorder still stopping from a rotation", async () => {
    const recorder = create();
    recorder.start();
    const first = recorders[0]!;
    first.stop = () => {
      first.state = "inactive";
    };
    recorder.rotate(true);

    let stopped = false;
    const stopping = recorder.stop(false).then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);

    first.onstop?.();
    await stopping;

    expect(ended.map((entry) => entry.segment).sort()).toEqual([0, 1]);
  });

  it("reports a recorder that stopped by itself and keeps its audio", () => {
    const recorder = create();
    recorder.start();

    recorders[0]?.stop();

    expect(ended).toEqual([{ segment: 0, keep: true }]);
    expect(interruptions).toBe(1);
  });

  it("doesn't count an ordinary stop as an interruption", async () => {
    const recorder = create();
    recorder.start();
    recorder.rotate(true);

    await recorder.stop(true);

    expect(interruptions).toBe(0);
  });

  it("doesn't stop a recorder that already stopped", () => {
    const recorder = create();
    recorder.start();
    const first = recorders[0]!;
    first.state = "inactive";
    first.stop = () => {
      throw new DOMException("already inactive", "InvalidStateError");
    };

    expect(() => recorder.rotate(true)).not.toThrow();
  });

  it("ignores empty chunks", () => {
    const recorder = create();

    recorder.start();
    recorders[0]?.ondataavailable?.({ data: new Blob([]) });

    expect(chunks).toEqual([]);
  });

  it("copes with a browser that allows one recorder at a time", () => {
    const recorder = create(1);

    recorder.start();
    recorder.rotate(true);

    expect(ended).toEqual([{ segment: 0, keep: true }]);
    expect(recorders).toHaveLength(2);
    expect(recorders[1]?.state).toBe("recording");
  });
});
