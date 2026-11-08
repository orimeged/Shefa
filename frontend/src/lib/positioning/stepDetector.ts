/**
 * Counts steps from accelerometer samples.
 *
 * The magnitude of acceleration needs no knowledge of how the phone is held, and
 * each footfall shows up as a peak above gravity. A step only counts as part of
 * a run: picking an item off a shelf gives a lone bump, and a walk gives rhythm.
 */

const GRAVITY_MS2 = 9.81;
const BASELINE_TIME_CONSTANT_MS = 1500;
const SMOOTHING_TIME_CONSTANT_MS = 50;
const MAX_SAMPLE_GAP_MS = 200;

const MIN_PEAK_MS2 = 0.4;
const MAX_PEAK_MS2 = 14;
const ADAPTIVE_THRESHOLD_SHARE = 0.35;
const PEAK_AVERAGE_RATE = 0.2;

const MIN_STEP_INTERVAL_MS = 280;
const MAX_STEP_INTERVAL_MS = 1300;
const STEPS_TO_CONFIRM_WALKING = 3;
/** Shaking swings both ways, so the weaker peaks around a violent one aren't steps either. */
const SHAKE_HOLD_OFF_MS = 1000;

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
  private shakingUntilMs = Number.NEGATIVE_INFINITY;

  /** Feeds one sample and returns how many steps it confirmed. */
  push(x: number, y: number, z: number, timeMs: number): number {
    const magnitude = Math.hypot(x, y, z);
    const elapsed = this.lastSampleMs === null ? 0 : timeMs - this.lastSampleMs;
    this.lastSampleMs = timeMs;

    if (elapsed > MAX_SAMPLE_GAP_MS) {
      this.signal = 0;
      this.inPeak = false;
    }
    if (magnitude - GRAVITY_MS2 > MAX_PEAK_MS2) {
      this.shakingUntilMs = timeMs + SHAKE_HOLD_OFF_MS;
      this.runLength = 0;
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

  private get threshold(): number {
    return Math.max(MIN_PEAK_MS2, this.averagePeak * ADAPTIVE_THRESHOLD_SHARE);
  }

  private finishPeak(): number {
    const sinceLastStep = this.peakTimeMs - this.lastStepMs;
    if (this.peakTimeMs < this.shakingUntilMs || sinceLastStep < MIN_STEP_INTERVAL_MS) {
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
