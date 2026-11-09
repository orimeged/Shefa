/**
 * Counts steps from accelerometer samples.
 *
 * The magnitude of acceleration needs no knowledge of how the phone is held, and
 * each footfall shows up as a peak above gravity. A step only counts as part of
 * a run: picking an item off a shelf gives a lone bump, and a walk gives rhythm.
 *
 * Moving the phone about in the hand gives peaks and rhythm too, and often
 * stronger ones than walking, so no amplitude threshold tells them apart. The
 * gyroscope does: a phone carried in front of someone walking barely tips, while
 * a hand waving it tips it fast. Turning a corner turns it about the vertical
 * only, which doesn't count, so tracking keeps going round corners.
 */

const GRAVITY_MS2 = 9.81;
const BASELINE_TIME_CONSTANT_MS = 1500;
const SMOOTHING_TIME_CONSTANT_MS = 50;
const MAX_SAMPLE_GAP_MS = 200;

const MIN_PEAK_MS2 = 0.4;
/**
 * A jolt this far above gravity, nearly twice gravity in all, is the hand: a
 * phone held in front of someone walking stays within about half that.
 */
const MAX_PEAK_MS2 = 8;
const ADAPTIVE_THRESHOLD_SHARE = 0.35;
const PEAK_AVERAGE_RATE = 0.2;

const MIN_STEP_INTERVAL_MS = 280;
const MAX_STEP_INTERVAL_MS = 1300;
const STEPS_TO_CONFIRM_WALKING = 3;
/** Shaking swings both ways, so the weaker peaks around a violent one aren't steps either. */
const SHAKE_HOLD_OFF_MS = 1000;

/** Which way is down in the phone's own axes, from the accelerometer averaged over this long. */
const GRAVITY_TIME_CONSTANT_MS = 400;
const TILT_SMOOTHING_MS = 200;
/**
 * Tipping faster than this, in degrees a second, is the hand moving the phone.
 * Walking sways a phone held in front by a few degrees, some 20-40 deg/s.
 */
const HAND_TILT_DEG_PER_S = 100;
/** The swing back after a wave, and the hand settling, aren't steps either. */
const HAND_HOLD_OFF_MS = 700;

/** The gyroscope's reading, as `DeviceMotionEvent.rotationRate` gives it: degrees a second. */
export interface RotationRate {
  /** About the phone's z axis, out of the screen. */
  alpha: number | null;
  /** About its x axis, across the screen. */
  beta: number | null;
  /** About its y axis, up the screen. */
  gamma: number | null;
}

export class StepDetector {
  private lastSampleMs: number | null = null;
  private baseline = GRAVITY_MS2;
  private signal = 0;

  private inPeak = false;
  private peak = 0;
  private peakTimeMs = 0;
  private averagePeak = 0;

  private lastStepMs = Number.NEGATIVE_INFINITY;
  private runLength = 0;
  /** Until then the phone is being handled, by a jolt or a tilt, and peaks aren't steps. */
  private handledUntilMs = Number.NEGATIVE_INFINITY;

  private down: [number, number, number] | null = null;
  private tiltRate = 0;

  /**
   * Feeds one sample and returns how many steps it confirmed. Without the
   * gyroscope's `rotation`, as on a phone that has none, only the jolt limit
   * tells the hand from the feet.
   */
  push(x: number, y: number, z: number, timeMs: number, rotation?: RotationRate | null): number {
    const magnitude = Math.hypot(x, y, z);
    const elapsed = this.lastSampleMs === null ? 0 : timeMs - this.lastSampleMs;
    this.lastSampleMs = timeMs;

    if (elapsed > MAX_SAMPLE_GAP_MS) {
      this.signal = 0;
      this.inPeak = false;
      this.tiltRate = 0;
    }
    if (magnitude - GRAVITY_MS2 > MAX_PEAK_MS2) {
      this.handle(timeMs + SHAKE_HOLD_OFF_MS);
    }
    this.trackDown(x, y, z, elapsed);
    if (rotation && this.tilting(rotation, elapsed)) {
      this.handle(timeMs + HAND_HOLD_OFF_MS);
    }

    this.baseline += (magnitude - this.baseline) * rate(elapsed, BASELINE_TIME_CONSTANT_MS);
    this.signal += (magnitude - this.baseline - this.signal) * rate(elapsed, SMOOTHING_TIME_CONSTANT_MS);

    if (this.inPeak) {
      if (this.signal > this.peak) {
        this.peak = this.signal;
        this.peakTimeMs = timeMs;
      }
      if (this.signal < 0) {
        this.inPeak = false;
        return this.finishPeak();
      }
    } else if (this.signal > this.threshold) {
      this.inPeak = true;
      this.peak = this.signal;
      this.peakTimeMs = timeMs;
    }
    return 0;
  }

  /** How fast the phone tips, smoothed, in degrees a second; for tests. */
  get tiltDegreesPerSecond(): number {
    return this.tiltRate;
  }

  private get threshold(): number {
    return Math.max(MIN_PEAK_MS2, this.averagePeak * ADAPTIVE_THRESHOLD_SHARE);
  }

  /** The hand has the phone: no steps until `untilMs`, and a walk starts its run again. */
  private handle(untilMs: number): void {
    this.handledUntilMs = Math.max(this.handledUntilMs, untilMs);
    this.runLength = 0;
  }

  private trackDown(x: number, y: number, z: number, elapsed: number): void {
    const down = this.down;
    if (!down) {
      this.down = [x, y, z];
      return;
    }
    const share = rate(elapsed, GRAVITY_TIME_CONSTANT_MS);
    down[0] += (x - down[0]) * share;
    down[1] += (y - down[1]) * share;
    down[2] += (z - down[2]) * share;
  }

  /**
   * Whether the phone is tipping fast: its rotation with the part about the
   * vertical taken out, since that part is the shopper turning, not the hand.
   */
  private tilting({ alpha, beta, gamma }: RotationRate, elapsed: number): boolean {
    const down = this.down;
    if ((alpha === null && beta === null && gamma === null) || !down) {
      return false;
    }
    const length = Math.hypot(...down);
    if (length < 1) {
      return false;
    }
    // About x, y and z in the phone's axes, which is how gravity is read too.
    const spin: [number, number, number] = [beta ?? 0, gamma ?? 0, alpha ?? 0];
    const aboutVertical = (spin[0] * down[0] + spin[1] * down[1] + spin[2] * down[2]) / length;
    const tilt = Math.sqrt(Math.max(0, Math.hypot(...spin) ** 2 - aboutVertical ** 2));
    this.tiltRate += (tilt - this.tiltRate) * rate(elapsed, TILT_SMOOTHING_MS);
    return this.tiltRate > HAND_TILT_DEG_PER_S;
  }

  private finishPeak(): number {
    const sinceLastStep = this.peakTimeMs - this.lastStepMs;
    if (this.peakTimeMs < this.handledUntilMs || sinceLastStep < MIN_STEP_INTERVAL_MS) {
      return 0;
    }

    this.averagePeak += (this.peak - this.averagePeak) * PEAK_AVERAGE_RATE;
    this.runLength = sinceLastStep > MAX_STEP_INTERVAL_MS ? 1 : this.runLength + 1;
    this.lastStepMs = this.peakTimeMs;

    if (this.runLength < STEPS_TO_CONFIRM_WALKING) {
      return 0;
    }
    return this.runLength === STEPS_TO_CONFIRM_WALKING ? STEPS_TO_CONFIRM_WALKING : 1;
  }
}

function rate(elapsedMs: number, timeConstantMs: number): number {
  return 1 - Math.exp(-elapsedMs / timeConstantMs);
}
