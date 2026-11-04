/**
 * Decides where to cut the audio, from its loudness alone.
 *
 * A cut at a natural pause gives speech-to-text a clean phrase and gives the list
 * one item per breath. Quiet stretches are dropped unsent, because a transcription
 * model invents words when handed silence. A supermarket is never silent, so what
 * counts as speech is measured against the room's own noise rather than a fixed level.
 */

export type GateDecision = "end-segment" | "drop-segment" | null;

/** Louder than the room by this much counts as speech. */
const SPEECH_OVER_NOISE = 2.5;
/** Below any real voice, so a silent room doesn't count every whisper of hiss. */
const MIN_SPEECH_LEVEL = 0.012;
const MIN_SPEECH_MS = 160;
/** Long enough to outlast a breath, short enough that items don't blur together. */
const PAUSE_MS = 750;
/** Without a pause the audio is cut anyway, so nothing waits long for its text. */
const MAX_SEGMENT_MS = 12_000;
const NOISE_TIME_CONSTANT_MS = 1500;

export class VoiceActivityGate {
  private noiseFloor: number | null = null;
  private segmentStartMs: number | null = null;
  private lastTimeMs: number | null = null;
  private lastSpeechMs = 0;
  private speechMs = 0;
  private speaking = false;

  get isSpeaking(): boolean {
    return this.speaking;
  }

  get hasSpeech(): boolean {
    return this.speechMs >= MIN_SPEECH_MS;
  }

  /** Feeds one loudness reading (0 to 1) and says whether to cut the audio here. */
  update(level: number, timeMs: number): GateDecision {
    this.segmentStartMs ??= timeMs;
    const elapsed = this.lastTimeMs === null ? 0 : timeMs - this.lastTimeMs;
    this.lastTimeMs = timeMs;

    const floor = this.noiseFloor ?? level;
    this.speaking = level > Math.max(MIN_SPEECH_LEVEL, floor * SPEECH_OVER_NOISE);

    if (this.speaking) {
      this.speechMs += elapsed;
      this.lastSpeechMs = timeMs;
    } else {
      // Only quiet moments teach the noise level, or speech would raise the bar.
      this.noiseFloor = floor + (level - floor) * (1 - Math.exp(-elapsed / NOISE_TIME_CONSTANT_MS));
    }

    if (this.hasSpeech && timeMs - this.lastSpeechMs >= PAUSE_MS) {
      return this.startSegment(timeMs, "end-segment");
    }
    if (timeMs - this.segmentStartMs >= MAX_SEGMENT_MS) {
      return this.startSegment(timeMs, this.hasSpeech ? "end-segment" : "drop-segment");
    }
    return null;
  }

  private startSegment(timeMs: number, decision: GateDecision): GateDecision {
    this.segmentStartMs = timeMs;
    this.speechMs = 0;
    return decision;
  }
}
