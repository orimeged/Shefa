/**
 * Records one whole clip, for a manager walking along a shelf.
 *
 * Shoppers' dictation cuts at pauses because a shopper is waiting on each phrase.
 * Here the list is reviewed at the end, so one recorder runs from start to finish.
 */

import type { RecorderFactory, RecorderLike } from "../dictation/segmentRecorder";

const CHUNK_MS = 1000;

export class ClipRecorder {
  private readonly chunks: Blob[] = [];
  private readonly recorder: RecorderLike;
  private discarded = false;

  /** `onClip` also fires when recording stops by itself, as for a phone call. */
  constructor(
    createRecorder: RecorderFactory,
    mimeType: string,
    onClip: (clip: Blob | null) => void,
  ) {
    this.recorder = createRecorder(mimeType);
    this.recorder.ondataavailable = ({ data }) => {
      if (data.size > 0) {
        this.chunks.push(data);
      }
    };
    this.recorder.onstop = () => {
      const hasAudio = !this.discarded && this.chunks.length > 0;
      onClip(hasAudio ? new Blob(this.chunks, { type: mimeType }) : null);
    };
  }

  start(): void {
    this.recorder.start(CHUNK_MS);
  }

  stop(): void {
    if (this.recorder.state !== "inactive") {
      this.recorder.stop();
    }
  }

  discard(): void {
    this.discarded = true;
    this.stop();
  }
}

export function formatClock(seconds: number): string {
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}
