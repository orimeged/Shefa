import type { LucideIcon } from "lucide-react";
import { CircleAlert, Footprints, LoaderCircle, Navigation } from "lucide-react";

import type { PositioningStatus } from "../../hooks/useLiveIndoorPositioning";
import { useLanguage } from "../../i18n/LanguageProvider";

interface LiveLocationControlProps {
  status: PositioningStatus;
  /** Tracking starts from the entrance, so it can only begin before the first tick. */
  canStart: boolean;
  onStart: () => void;
  onStop: () => void;
}

const BASE =
  "flex h-9 items-center gap-2 rounded-full px-4 text-sm font-semibold whitespace-nowrap shadow-sm";

export function LiveLocationControl({
  status,
  canStart,
  onStart,
  onStop,
}: LiveLocationControlProps) {
  const { t } = useLanguage();

  const content = (): [string, LucideIcon, string, (() => void)?] | null => {
    switch (status) {
      case "idle":
        return canStart
          ? [t.liveStart, Navigation, "bg-surface text-you ring-1 ring-you/40", onStart]
          : null;
      case "requesting":
        return [t.liveRequesting, LoaderCircle, "bg-ink/85 text-white"];
      case "calibrating":
        return [t.liveCalibrating, Footprints, "bg-next text-ink", onStop];
      case "tracking":
        return [t.liveOn, Navigation, "bg-surface text-you ring-1 ring-you", onStop];
      case "denied":
        return [t.liveDenied, CircleAlert, "bg-danger-soft text-danger", onStart];
      case "no-data":
        return [t.liveNoData, CircleAlert, "bg-danger-soft text-danger", onStart];
      case "insecure":
        return [t.liveInsecure, CircleAlert, "bg-danger-soft text-danger"];
      case "unsupported":
        return [t.liveUnsupported, CircleAlert, "bg-danger-soft text-danger"];
    }
  };

  const shown = content();
  if (!shown) {
    return null;
  }
  const [label, Icon, tone, onClick] = shown;
  const icon = (
    <Icon aria-hidden className={`size-4 ${status === "requesting" ? "animate-spin" : ""}`} />
  );

  // Sits in the empty band between the first cross-aisle and the store front.
  return (
    <div className="absolute inset-x-0 top-[79.5%] -mt-1 flex h-11 items-center justify-center">
      {onClick ? (
        // The band is too thin to draw a full tap target, so the padding carries it.
        <button type="button" onClick={onClick} className="py-1">
          <span className={`${BASE} ${tone}`}>
            {icon}
            {label}
          </span>
        </button>
      ) : (
        <p role="status" className={`${BASE} ${tone}`}>
          {icon}
          {label}
        </p>
      )}
    </div>
  );
}
