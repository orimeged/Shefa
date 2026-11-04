/**
 * Records audio as a run of complete files.
 *
 * MediaRecorder only writes its header in the first chunk, so a later chunk means
 * nothing alone and a transcription API can't read it. Each segment therefore gets
 * its own recorder, while its chunks still leave as they're produced. The next
 * recorder starts just before the old one stops, so no word falls between them.
 */

const CHUNK_MS = 300;
const AUDIO_BITS_PER_SECOND = 32_000;

const PREFERRED_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4;codecs=mp4a.40.2",
  "audio/mp4",
];

export interface RecorderLike {
  state: string;
  ondataavailable: ((event: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
  start: (timeslice: number) => void;
  stop: () => void;
}

export type RecorderFactory = (mimeType: string) => RecorderLike;

export interface SegmentSink {
  chunk: (segment: number, data: Blob) => void;
  /** All of a segment's audio has been delivered. `keep` is false for silence. */
  ended: (segment: number, keep: boolean) => void;
  /** Recording stopped without being asked, as when a phone call takes the microphone. */
  interrupted: () => void;
}

export function pickMimeType(isSupported: (type: string) => boolean): string | null {
  return PREFERRED_TYPES.find(isSupported) ?? null;
}

export function browserRecorderFactory(stream: MediaStream): RecorderFactory {
  return (mimeType) =>
    new MediaRecorder(stream, {
      mimeType,
      audioBitsPerSecond: AUDIO_BITS_PER_SECOND,
    }) as unknown as RecorderLike;
}

export class SegmentRecorder {
  private readonly decisions = new Map<RecorderLike, boolean>();
  private current: RecorderLike | null = null;
  private nextSegment = 0;
  private running = 0;
  private restartWhenStopped = false;
  private drained: (() => void) | null = null;

  constructor(
    private readonly createRecorder: RecorderFactory,
    private readonly mimeType: string,
    private readonly sink: SegmentSink,
  ) {}

  start(): void {
    this.current = this.begin();
  }

  /** Closes the current segment and opens the next, with no gap in the audio. */
  rotate(keep: boolean): void {
    const finishing = this.current;
    if (!finishing) {
      return;
    }
    this.decisions.set(finishing, keep);
    try {
      this.current = this.begin();
    } catch {
      // A browser that won't run two recorders at once gets a tiny gap instead.
      this.current = null;
      this.restartWhenStopped = true;
    }
    stopRecorder(finishing);
  }

  /** Resolves once the last audio is delivered: a recorder's final chunk comes after stop(). */
  stop(keep: boolean): Promise<void> {
    this.restartWhenStopped = false;
    const last = this.current;
    this.current = null;
    if (last) {
      this.decisions.set(last, keep);
      stopRecorder(last);
    }
    return new Promise((resolve) => {
      if (this.running === 0) {
        resolve();
      } else {
        this.drained = resolve;
      }
    });
  }

  private begin(): RecorderLike {
    const recorder = this.createRecorder(this.mimeType);
    const segment = this.nextSegment;
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        this.sink.chunk(segment, event.data);
      }
    };
    recorder.onstop = () => this.handleStop(recorder, segment);
    recorder.start(CHUNK_MS);
    this.nextSegment += 1;
    this.running += 1;
    return recorder;
  }

  private handleStop(recorder: RecorderLike, segment: number): void {
    this.running -= 1;
    const interrupted = recorder === this.current;
    if (interrupted) {
      this.current = null;
    }

    // An interrupted segment was never judged, and it may hold speech.
    this.sink.ended(segment, this.decisions.get(recorder) ?? true);
    this.decisions.delete(recorder);
    if (this.running === 0) {
      this.drained?.();
    }

    if (interrupted) {
      this.sink.interrupted();
    } else if (this.restartWhenStopped) {
      this.restartWhenStopped = false;
      try {
        this.current = this.begin();
      } catch {
        this.sink.interrupted();
      }
    }
  }
}

/** Older Safari throws on stopping a recorder that has already stopped itself. */
function stopRecorder(recorder: RecorderLike): void {
  if (recorder.state !== "inactive") {
    recorder.stop();
  }
}
