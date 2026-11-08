/**
 * One spoken list, from the first tap to the text on the list.
 *
 * The microphone stays open for the whole session and only Done ends it, so a
 * breath can't cut anything off. Loudness picks the pauses, each phrase becomes
 * its own audio file, and text comes back from the server as it's ready. Phrases
 * can return out of order, so they're kept by position.
 */

import type { Microphone } from "./microphone";
import type { SegmentSink } from "./segmentRecorder";
import type { TranscriptionEvents } from "./transcriptionClient";
import { VoiceActivityGate } from "./voiceActivity";

export type DictationStatus = "idle" | "starting" | "listening" | "finishing" | "unavailable";

export interface RecorderControl {
  start: () => void;
  rotate: (keep: boolean) => void;
  stop: (keep: boolean) => Promise<void>;
}

export interface TransportControl {
  connect: () => Promise<void>;
  chunk: (segment: number, data: Blob) => void;
  endSegment: (segment: number) => void;
  discardSegment: (segment: number) => void;
  finish: () => Promise<void>;
  close: () => void;
}

export interface SessionDependencies {
  openMicrophone: () => Promise<Microphone>;
  createTransport: (events: TranscriptionEvents) => TransportControl;
  createRecorder: (stream: MediaStream, sink: SegmentSink) => RecorderControl;
}

export interface SessionEvents {
  status: (status: DictationStatus) => void;
  transcript: (text: string) => void;
  speaking: (isSpeaking: boolean) => void;
  failedSegments: (count: number) => void;
  finished: (text: string) => void;
}

const TICK_MS = 60;
/** So a forgotten session can't keep the microphone on in a pocket. */
const MAX_SESSION_MS = 180_000;

export class DictationSession {
  private readonly gate = new VoiceActivityGate();
  private readonly lines = new Map<number, string>();
  private microphone: Microphone | null = null;
  private transport: TransportControl | null = null;
  private recorder: RecorderControl | null = null;
  private ticker: ReturnType<typeof setInterval> | undefined;
  private startedAtMs = 0;
  private failures = 0;
  private wasSpeaking = false;
  /** Loudness couldn't be read for part of this segment, so it may hold speech. */
  private heardNothing = false;
  private over = false;

  constructor(
    private readonly dependencies: SessionDependencies,
    private readonly events: SessionEvents,
    private readonly now: () => number = () => performance.now(),
  ) {}

  /** Call from a tap. */
  async start(): Promise<void> {
    this.events.status("starting");
    try {
      const microphone = await this.dependencies.openMicrophone();
      this.microphone = microphone;
      const transport = this.dependencies.createTransport({
        transcript: (segment, text) => this.receive(segment, text),
        failed: () => this.fail(),
      });
      this.transport = transport;
      if (!this.over) {
        await transport.connect();
      }
      if (this.over) {
        this.release();
        return;
      }
      this.recorder = this.dependencies.createRecorder(microphone.stream, {
        chunk: (segment, data) => transport.chunk(segment, data),
        ended: (segment, keep) => {
          if (keep) {
            transport.endSegment(segment);
          } else {
            transport.discardSegment(segment);
          }
        },
        interrupted: () => void this.finish(),
      });
      this.recorder.start();
    } catch {
      this.release();
      if (!this.over) {
        this.over = true;
        this.events.status("unavailable");
      }
      return;
    }

    this.startedAtMs = this.now();
    this.ticker = setInterval(() => this.tick(), TICK_MS);
    this.events.status("listening");
  }

  async finish(): Promise<void> {
    if (this.over) {
      return;
    }
    this.over = true;
    clearInterval(this.ticker);
    this.events.status("finishing");
    this.events.speaking(false);
    await this.recorder?.stop(this.gate.hasSpeech || this.heardNothing);
    this.microphone?.close();
    await this.transport?.finish();

    const text = this.text();
    this.release();
    this.events.transcript("");
    // Everything failed: nothing reached the list, and silence wouldn't explain why.
    this.events.status(!text && this.failures > 0 ? "unavailable" : "idle");
    if (text) {
      this.events.finished(text);
    }
  }

  cancel(): void {
    if (this.over) {
      return;
    }
    this.over = true;
    clearInterval(this.ticker);
    void this.recorder?.stop(false);
    this.release();
    this.events.speaking(false);
    this.events.transcript("");
    this.events.status("idle");
  }

  private tick(): void {
    const timeMs = this.now();
    if (timeMs - this.startedAtMs >= MAX_SESSION_MS) {
      void this.finish();
      return;
    }

    // Unreadable loudness isn't silence, so no cut can be trusted until it's back.
    const level = this.microphone?.level() ?? null;
    if (level === null) {
      this.heardNothing = true;
      return;
    }

    const decision = this.gate.update(level, timeMs);
    if (decision) {
      this.recorder?.rotate(decision === "end-segment" || this.heardNothing);
      this.heardNothing = false;
    }
    if (this.gate.isSpeaking !== this.wasSpeaking) {
      this.wasSpeaking = this.gate.isSpeaking;
      this.events.speaking(this.wasSpeaking);
    }
  }

  private receive(segment: number, text: string): void {
    if (text) {
      this.lines.set(segment, text);
      this.events.transcript(this.text());
    }
  }

  private fail(): void {
    this.failures += 1;
    this.events.failedSegments(this.failures);
  }

  private text(): string {
    return [...this.lines.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, line]) => line)
      .join("\n");
  }

  private release(): void {
    clearInterval(this.ticker);
    this.microphone?.close();
    this.transport?.close();
    this.microphone = null;
    this.transport = null;
    this.recorder = null;
  }
}
