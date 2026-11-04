/**
 * Gets "not found here" reports to the server despite a store's signal.
 *
 * Reception is usually at its worst in the aisle where the report is made, so
 * each one is written to storage first and leaves when it can. A retry can't count
 * twice: the client picks the event's id and the server ignores one it has seen.
 */

import { ApiError } from "../../api/client";
import type { NotFoundReport } from "../../api/types";

const STORAGE_KEY = "not-found-queue:v1";
const MAX_QUEUED = 200;
const FIRST_RETRY_MS = 15_000;
const MAX_RETRY_MS = 5 * 60_000;

type QueueStorage = Pick<Storage, "getItem" | "setItem">;

/** Not crypto.randomUUID: it doesn't exist on plain HTTP, and the demo can run there. */
export function newUuid(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

/** Private browsing can refuse storage: reports then last as long as the page. */
export function browserStorage(): QueueStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** The server understood and refused this report, so sending it again can't help. */
function isRefused(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.status >= 400 &&
    error.status < 500 &&
    error.status !== 408 &&
    error.status !== 429
  );
}

export class NotFoundQueue {
  private reports: NotFoundReport[];
  private isFlushing = false;
  private retryDelayMs = FIRST_RETRY_MS;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly send: (report: NotFoundReport) => Promise<void>,
    private readonly storage: QueueStorage | null,
  ) {
    this.reports = this.load();
  }

  add(report: NotFoundReport): void {
    this.reports = [...this.reports, report].slice(-MAX_QUEUED);
    this.save();
    void this.flush();
  }

  async flush(): Promise<void> {
    if (this.isFlushing) {
      return;
    }
    this.isFlushing = true;
    clearTimeout(this.retryTimer);
    try {
      let next = this.reports[0];
      while (next) {
        try {
          await this.send(next);
        } catch (error) {
          if (!isRefused(error)) {
            this.retryLater();
            return;
          }
        }
        this.remove(next.event_id);
        this.retryDelayMs = FIRST_RETRY_MS;
        next = this.reports[0];
      }
    } finally {
      this.isFlushing = false;
    }
  }

  stop(): void {
    clearTimeout(this.retryTimer);
  }

  private retryLater(): void {
    this.retryTimer = setTimeout(() => void this.flush(), this.retryDelayMs);
    this.retryDelayMs = Math.min(MAX_RETRY_MS, this.retryDelayMs * 2);
  }

  private remove(eventId: string): void {
    this.reports = this.reports.filter((report) => report.event_id !== eventId);
    this.save();
  }

  private load(): NotFoundReport[] {
    try {
      const stored = this.storage?.getItem(STORAGE_KEY);
      return stored ? (JSON.parse(stored) as NotFoundReport[]) : [];
    } catch {
      return [];
    }
  }

  private save(): void {
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify(this.reports));
    } catch {
      // A full disk: the report still leaves if the page stays open.
    }
  }
}
