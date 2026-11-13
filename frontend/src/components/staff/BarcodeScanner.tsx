import { CameraOff, LoaderCircle, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useLanguage } from "../../i18n/LanguageProvider";
import { createDetector, isProductCode } from "../../lib/staff/barcode";

interface BarcodeScannerProps {
  onDetected: (barcode: string) => void;
  onClose: () => void;
}

const SCAN_EVERY_MS = 200;

type Problem = "denied" | "no-camera" | "no-reader";

/** The back camera, full screen, until it reads a product code. */
export function BarcodeScanner({ onDetected, onClose }: BarcodeScannerProps) {
  const { t } = useLanguage();
  const video = useRef<HTMLVideoElement>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [isStarting, setIsStarting] = useState(true);
  const latest = useRef(onDetected);
  useEffect(() => {
    latest.current = onDetected;
  });

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      } catch (error) {
        setProblem(error instanceof DOMException && error.name === "NotAllowedError" ? "denied" : "no-camera");
        setIsStarting(false);
        return;
      }
      const element = video.current;
      if (stopped || !element) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      element.srcObject = stream;
      await element.play().catch(() => undefined);
      let detector;
      try {
        detector = await createDetector();
      } catch {
        setProblem("no-reader");
        setIsStarting(false);
        return;
      }
      setIsStarting(false);
      const tick = async () => {
        if (stopped) return;
        try {
          const codes = await detector.detect(element);
          const code = codes.map((found) => found.rawValue.trim()).find(isProductCode);
          if (code) {
            navigator.vibrate?.(60);
            latest.current(code);
            return;
          }
        } catch {
          // A frame that couldn't be read; the next one will be.
        }
        timer = setTimeout(() => void tick(), SCAN_EVERY_MS);
      };
      void tick();
    })();

    return () => {
      stopped = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  return (
    <div role="dialog" aria-label={t.placeScanTitle} className="fixed inset-0 z-40 flex flex-col bg-black text-white">
      <div className="flex items-center gap-2 px-4 pt-[calc(0.75rem+env(safe-area-inset-top))] pb-3">
        <p className="flex-1 font-semibold">{t.placeScanHint}</p>
        <button type="button" onClick={onClose} aria-label={t.closePanel} className="grid size-11 place-items-center rounded-full bg-white/15">
          <X aria-hidden className="size-5" />
        </button>
      </div>
      <div className="relative flex-1 overflow-hidden">
        <video ref={video} playsInline muted autoPlay className="absolute inset-0 size-full object-cover" />
        {!problem && (
          <div aria-hidden className="pointer-events-none absolute inset-x-8 top-1/2 h-40 -translate-y-1/2 rounded-3xl ring-4 ring-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]" />
        )}
        {isStarting && (
          <LoaderCircle aria-hidden className="absolute top-1/2 left-1/2 size-10 -translate-x-1/2 -translate-y-1/2 animate-spin" />
        )}
        {problem && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-8 text-center">
            <CameraOff aria-hidden className="size-10" />
            <p role="alert">{problem === "denied" ? t.placeCameraDenied : problem === "no-reader" ? t.placeNoReader : t.placeNoCamera}</p>
            <button type="button" onClick={onClose} className="h-12 rounded-2xl bg-white px-6 font-semibold text-black">
              {t.placeTypeInstead}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
