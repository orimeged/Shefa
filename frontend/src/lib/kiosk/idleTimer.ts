/**
 * Fires when nobody has touched the screen for `timeoutMs`, and keeps firing at that
 * pace while nobody does. The repeats are how an unattended kiosk stays up to date.
 */
export class IdleTimer {
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly timeoutMs: number,
    private readonly onIdle: () => void,
  ) {}

  readonly activity = (): void => {
    this.stop();
    this.timer = setTimeout(() => {
      this.onIdle();
      this.activity();
    }, this.timeoutMs);
  };

  stop(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
