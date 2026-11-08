import { LoaderCircle, Mic } from "lucide-react";

import { useLanguage } from "../../i18n/LanguageProvider";
import type { DictationStatus } from "../../lib/dictation/dictationSession";

interface DictationOverlayProps {
  status: DictationStatus;
  transcript: string;
  isSpeaking: boolean;
  failedSegments: number;
  onFinish: () => void;
  onCancel: () => void;
}

export function DictationOverlay({
  status,
  transcript,
  isSpeaking,
  failedSegments,
  onFinish,
  onCancel,
}: DictationOverlayProps) {
  const { t } = useLanguage();
  const isListening = status === "listening";

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 mx-auto max-w-xl rounded-t-[2rem] bg-brand-strong px-5 pt-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] text-white shadow-2xl">
      <div className="flex items-center gap-3">
        <span className="relative grid size-12 shrink-0 place-items-center rounded-full bg-white/15">
          {isListening ? (
            <>
              {isSpeaking && (
                <span aria-hidden className="pulse-ring absolute inset-0 rounded-full bg-white/30" />
              )}
              <Mic aria-hidden className="size-6" />
            </>
          ) : (
            <LoaderCircle aria-hidden className="size-6 animate-spin" />
          )}
        </span>
        <div className="min-w-0" role="status">
          <p className="text-xl font-semibold">
            {status === "starting"
              ? t.dictationStarting
              : status === "finishing"
                ? t.dictationFinishing
                : t.listening}
          </p>
          <p className="text-sm text-white/75">{t.listeningHint}</p>
        </div>
      </div>

      <p
        aria-live="polite"
        className="mt-4 max-h-[30dvh] min-h-14 overflow-y-auto rounded-2xl bg-white/10 px-4 py-3 text-lg whitespace-pre-line"
      >
        {transcript}
      </p>

      {failedSegments > 0 && (
        <p role="alert" className="mt-2 rounded-xl bg-next-soft px-3 py-2 font-medium text-ink">
          {t.dictationSegmentFailed}
        </p>
      )}

      <div className="mt-3 grid grid-cols-[1fr_2fr] gap-3">
        <button
          type="button"
          onClick={onCancel}
          disabled={status === "finishing"}
          className="h-14 rounded-2xl font-medium ring-1 ring-white/40 disabled:opacity-50"
        >
          {t.cancelDictation}
        </button>
        <button
          type="button"
          onClick={onFinish}
          disabled={!isListening}
          className="h-14 rounded-2xl bg-white text-lg font-semibold text-brand-strong disabled:opacity-50"
        >
          {t.finishDictation}
        </button>
      </div>
    </div>
  );
}
