import { describe, expect, it } from "vitest";

import type { GateDecision } from "./voiceActivity";
import { VoiceActivityGate } from "./voiceActivity";

/** A seeded generator (mulberry32), so the noise is the same on every run. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

const TICK_MS = 50;

interface Span {
  ms: number;
  level: number;
}

function run(spans: readonly Span[], gate = new VoiceActivityGate()) {
  const decisions: { decision: GateDecision; timeMs: number }[] = [];
  let timeMs = 0;
  for (const span of spans) {
    for (let elapsed = 0; elapsed < span.ms; elapsed += TICK_MS) {
      const decision = gate.update(span.level, timeMs);
      if (decision) {
        decisions.push({ decision, timeMs });
      }
      timeMs += TICK_MS;
    }
  }
  return { decisions, gate };
}

const QUIET = 0.002;
const VOICE = 0.1;

describe("VoiceActivityGate", () => {
  it("cuts after a pause in speech", () => {
    const { decisions } = run([
      { ms: 500, level: QUIET },
      { ms: 800, level: VOICE },
      { ms: 1000, level: QUIET },
    ]);

    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.decision).toBe("end-segment");
    expect(decisions[0]?.timeMs).toBeGreaterThanOrEqual(1300 + 700);
  });

  it("doesn't cut on a breath", () => {
    const { decisions } = run([
      { ms: 500, level: QUIET },
      { ms: 600, level: VOICE },
      { ms: 300, level: QUIET },
      { ms: 600, level: VOICE },
    ]);

    expect(decisions).toEqual([]);
  });

  it("gives every item its own segment", () => {
    const phrase = [
      { ms: 700, level: VOICE },
      { ms: 900, level: QUIET },
    ];
    const { decisions } = run([{ ms: 500, level: QUIET }, ...phrase, ...phrase, ...phrase]);

    expect(decisions.map((entry) => entry.decision)).toEqual([
      "end-segment",
      "end-segment",
      "end-segment",
    ]);
  });

  it("ignores a click too short to be a word", () => {
    const { decisions, gate } = run([
      { ms: 500, level: QUIET },
      { ms: 100, level: VOICE },
      { ms: 2000, level: QUIET },
    ]);

    expect(decisions).toEqual([]);
    expect(gate.hasSpeech).toBe(false);
  });

  it("cuts someone who never pauses", () => {
    const { decisions } = run([
      { ms: 500, level: QUIET },
      { ms: 15_000, level: VOICE },
    ]);

    expect(decisions[0]?.decision).toBe("end-segment");
    expect(decisions[0]?.timeMs).toBe(12_000);
  });

  it("drops a long quiet stretch so nothing is sent", () => {
    const { decisions } = run([{ ms: 13_000, level: QUIET }]);

    expect(decisions.map((entry) => entry.decision)).toEqual(["drop-segment"]);
  });

  it("hears a voice over supermarket noise", () => {
    const random = seededRandom(7);
    const gate = new VoiceActivityGate();
    const decisions: GateDecision[] = [];
    let timeMs = 0;
    const noise = () => 0.03 + random() * 0.01;

    for (const [ms, voice] of [
      [3000, false],
      [900, true],
      [1200, false],
    ] as const) {
      for (let elapsed = 0; elapsed < ms; elapsed += TICK_MS) {
        const level = voice ? noise() + 0.15 : noise();
        const decision = gate.update(level, timeMs);
        if (decision) decisions.push(decision);
        timeMs += TICK_MS;
      }
    }

    expect(decisions).toEqual(["end-segment"]);
  });

  it("doesn't mistake steady noise for speech", () => {
    const random = seededRandom(9);
    const gate = new VoiceActivityGate();
    let timeMs = 0;
    let speaking = 0;

    for (; timeMs < 11_000; timeMs += TICK_MS) {
      gate.update(0.03 + random() * 0.01, timeMs);
      if (gate.isSpeaking) speaking += 1;
    }

    expect(speaking).toBe(0);
    expect(gate.hasSpeech).toBe(false);
  });
});
