/** Keeps a tablet's screen on for as long as it's held. */

export interface WakeLockHandle {
  release: () => Promise<void>;
  addEventListener: (type: "release", listener: () => void) => void;
}

export interface WakeLockProvider {
  request: (type: "screen") => Promise<WakeLockHandle>;
}

/**
 * The browser drops the lock whenever the page is hidden, and it can refuse one on low
 * battery, so `acquire` is safe to call again at any time and does nothing while
 * a lock is held. A page can only hold one while it's visible.
 */
export class ScreenWakeLock {
  private handle: WakeLockHandle | null = null;
  private isRequesting = false;
  private isClosed = false;

  constructor(
    private readonly provider: WakeLockProvider | undefined,
    private readonly isVisible: () => boolean,
  ) {}

  async acquire(): Promise<void> {
    if (!this.provider || this.handle || this.isRequesting || this.isClosed || !this.isVisible()) {
      return;
    }
    this.isRequesting = true;
    try {
      const handle = await this.provider.request("screen");
      if (this.isClosed) {
        await handle.release();
        return;
      }
      this.handle = handle;
      handle.addEventListener("release", () => {
        this.handle = null;
      });
    } catch {
      // Refused for now. The next touch or return to the page asks again.
    } finally {
      this.isRequesting = false;
    }
  }

  close(): void {
    this.isClosed = true;
    void this.handle?.release().catch(() => undefined);
    this.handle = null;
  }
}
