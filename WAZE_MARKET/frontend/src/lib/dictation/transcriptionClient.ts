/**
 * Moves audio segments to the server and transcripts back.
 *
 * The WebSocket carries audio as it's recorded. It can't be the only way: iOS
 * refuses wss:// to a self-signed certificate even after the page's warning is
 * accepted, and signal drops in an aisle. So every segment stays here until its
 * transcript arrives, and if the socket is gone the same segment is uploaded whole.
 */

import { socketUrl } from "../../api/backend";

export interface TranscriptionEvents {
  transcript: (segment: number, text: string) => void;
  failed: (segment: number) => void;
}

export interface TranscriptionOptions {
  mimeType: string;
  language: string;
  socketUrl: string;
  uploadUrl: string;
  statusUrl: string;
  createSocket?: (url: string) => WebSocket;
  fetchImpl?: typeof fetch;
}

/** Long enough for a slow store network, short enough not to hold up a shopper. */
const SOCKET_TIMEOUT_MS = 2500;
const FINISH_TIMEOUT_MS = 25_000;
const SEGMENT_PREFIX_BYTES = 4;
/** The server closes with this when no speech-to-text engine is configured. */
const CLOSE_UNAVAILABLE = 1013;

interface Segment {
  blobs: Blob[];
  ended: boolean;
}

/** The server said no, or can't be reached: dictation can't work in this session. */
export class DictationUnavailableError extends Error {}

export function socketUrlFor(
  location: Pick<Location, "protocol" | "host">,
  backend?: string,
): string {
  return socketUrl("/ws/transcribe", location, backend);
}

export class TranscriptionClient {
  private readonly segments = new Map<number, Segment>();
  private readonly fetchImpl: typeof fetch;
  private socket: WebSocket | null = null;
  private sending: Promise<void> = Promise.resolve();
  private uploading: Promise<void> = Promise.resolve();
  private settled: (() => void) | null = null;
  private closed = false;

  constructor(
    private readonly options: TranscriptionOptions,
    private readonly events: TranscriptionEvents,
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch.bind(globalThis);
  }

  /** Resolves on a working path, and rejects only when dictation can't work at all. */
  async connect(): Promise<void> {
    if (await this.openSocket()) {
      return;
    }
    const response = await this.fetchImpl(this.options.statusUrl).catch(() => null);
    if (!response?.ok || !((await response.json()) as { available: boolean }).available) {
      throw new DictationUnavailableError();
    }
  }

  chunk(segment: number, data: Blob): void {
    const entry = this.segmentFor(segment);
    entry.blobs.push(data);
    const socket = this.openedSocket();
    if (socket) {
      this.sending = this.sending.then(async () => {
        const audio = await data.arrayBuffer();
        const frame = new Uint8Array(SEGMENT_PREFIX_BYTES + audio.byteLength);
        new DataView(frame.buffer).setUint32(0, segment);
        frame.set(new Uint8Array(audio), SEGMENT_PREFIX_BYTES);
        this.openedSocket()?.send(frame);
      });
    }
  }

  endSegment(segment: number): void {
    this.segmentFor(segment).ended = true;
    if (this.openedSocket()) {
      this.sendControl({ type: "segment_end", segment });
    } else {
      this.upload(segment);
    }
  }

  discardSegment(segment: number): void {
    this.segments.delete(segment);
    if (this.openedSocket()) {
      this.sendControl({ type: "segment_discard", segment });
    }
  }

  /** Waits for every outstanding transcript, then closes. */
  async finish(): Promise<void> {
    const settled = new Promise<void>((resolve) => {
      this.settled = resolve;
    });
    if (this.openedSocket()) {
      this.sendControl({ type: "finish" });
    } else {
      this.settleIfDone();
    }
    await Promise.race([
      settled,
      new Promise<void>((resolve) => setTimeout(resolve, FINISH_TIMEOUT_MS)),
    ]);
    this.close();
  }

  close(): void {
    this.closed = true;
    this.socket?.close();
    this.socket = null;
    this.segments.clear();
  }

  private openedSocket(): WebSocket | null {
    return this.socket?.readyState === 1 ? this.socket : null;
  }

  private segmentFor(segment: number): Segment {
    let entry = this.segments.get(segment);
    if (!entry) {
      entry = { blobs: [], ended: false };
      this.segments.set(segment, entry);
    }
    return entry;
  }

  private sendControl(message: object): void {
    this.sending = this.sending.then(() => this.openedSocket()?.send(JSON.stringify(message)));
  }

  private openSocket(): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const create = this.options.createSocket ?? ((url: string) => new WebSocket(url));
      let socket: WebSocket;
      try {
        socket = create(this.options.socketUrl);
      } catch {
        resolve(false);
        return;
      }

      let ready = false;
      const timer = setTimeout(() => {
        socket.onclose = null;
        socket.close();
        resolve(false);
      }, SOCKET_TIMEOUT_MS);

      socket.onopen = () => {
        socket.send(
          JSON.stringify({
            type: "start",
            mime_type: this.options.mimeType,
            language: this.options.language,
          }),
        );
      };
      socket.onmessage = (event) => {
        const message = JSON.parse(String(event.data)) as Record<string, unknown>;
        if (message.type === "ready") {
          ready = true;
          clearTimeout(timer);
          this.socket = socket;
          resolve(true);
        } else {
          this.handleMessage(message);
        }
      };
      socket.onclose = (event) => {
        clearTimeout(timer);
        if (ready) {
          this.handleSocketLost();
        } else if (event.code === CLOSE_UNAVAILABLE) {
          reject(new DictationUnavailableError());
        } else {
          resolve(false);
        }
      };
    });
  }

  private handleMessage(message: Record<string, unknown>): void {
    const segment = message.segment;
    if (message.type === "done") {
      this.settled?.();
    } else if (typeof segment === "number" && this.segments.delete(segment)) {
      if (message.type === "transcript") {
        this.events.transcript(segment, String(message.text ?? ""));
      } else {
        this.events.failed(segment);
      }
    }
  }

  /** Anything the server didn't answer is still here, so it goes up the other way. */
  private handleSocketLost(): void {
    this.socket = null;
    if (this.closed) {
      return;
    }
    for (const [segment, entry] of this.segments) {
      if (entry.ended) {
        this.upload(segment);
      }
    }
    this.settleIfDone();
  }

  private upload(segment: number): void {
    const entry = this.segments.get(segment);
    if (!entry) {
      return;
    }
    const url = `${this.options.uploadUrl}?language=${encodeURIComponent(this.options.language)}`;
    const body = new Blob(entry.blobs, { type: this.options.mimeType });

    this.uploading = this.uploading.then(async () => {
      try {
        const response = await this.fetchImpl(url, {
          method: "POST",
          headers: { "Content-Type": this.options.mimeType },
          body,
        });
        if (!response.ok) {
          throw new Error(`Upload failed with ${response.status}`);
        }
        const { text } = (await response.json()) as { text: string };
        if (this.segments.delete(segment)) {
          this.events.transcript(segment, text);
        }
      } catch {
        if (this.segments.delete(segment)) {
          this.events.failed(segment);
        }
      }
      this.settleIfDone();
    });
  }

  private settleIfDone(): void {
    const waiting = [...this.segments.values()].some((entry) => entry.ended);
    if (!waiting) {
      this.settled?.();
    }
  }
}
