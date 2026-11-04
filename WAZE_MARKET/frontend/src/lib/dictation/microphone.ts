/** The phone's microphone, with a loudness reading for finding pauses. */

export interface Microphone {
  stream: MediaStream;
  /** Current loudness from 0 to 1, or null when it can't be read just now. */
  level: () => number | null;
  close: () => void;
}

const ANALYSER_SIZE = 1024;

/**
 * Call from a tap: iOS only lets audio start inside one. The audio context is
 * created and resumed before the first await for that reason.
 */
export async function openMicrophone(): Promise<Microphone> {
  const AudioContextClass =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const context = new AudioContextClass();
  // Not awaited: it can stay pending for good, and level() copes with a suspended context.
  context.resume().catch(() => undefined);

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch (error) {
    void context.close();
    throw error;
  }

  const analyser = context.createAnalyser();
  analyser.fftSize = ANALYSER_SIZE;
  context.createMediaStreamSource(stream).connect(analyser);
  const samples = new Float32Array(analyser.fftSize);

  return {
    stream,
    level: () => {
      // iOS suspends audio on an interruption and leaves it to the page to resume.
      if (context.state !== "running") {
        context.resume().catch(() => undefined);
        return null;
      }
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) {
        sum += sample * sample;
      }
      // A live microphone is never exactly zero, so this is a dead analyser, not silence.
      return sum === 0 ? null : Math.sqrt(sum / samples.length);
    },
    // Safe to call twice: closing a closed context rejects.
    close: () => {
      stream.getTracks().forEach((track) => track.stop());
      context.close().catch(() => undefined);
    },
  };
}
