import { CircleAlert, LoaderCircle, Navigation, Search, X } from "lucide-react";

import type { PositioningStatus } from "../../hooks/useLiveIndoorPositioning";
import { useLanguage } from "../../i18n/LanguageProvider";

interface NavigationStartProps {
  status: PositioningStatus;
  /** The half of the map away from the entrance, so the way-in arrow stays in sight. */
  placement: "top" | "bottom";
  onStart: () => void;
  onDismiss: () => void;
}

/**
 * The way into live navigation: one big button over the map, and the one thing
 * to do first, which is to stand at the entrance facing in. The arrow on the map
 * shows which way that is; the phone takes that as its bearing when tapped.
 */
export function NavigationStart({ status, placement, onStart, onDismiss }: NavigationStartProps) {
  const { t } = useLanguage();
  const problem =
    status === "denied"
      ? t.liveDenied
      : status === "no-data"
        ? t.liveNoData
        : status === "insecure"
          ? t.liveInsecure
          : status === "unsupported"
            ? t.liveUnsupported
            : null;
  const canTry = status !== "insecure" && status !== "unsupported";
  const isAsking = status === "requesting";

  return (
    <section
      aria-label={t.navTitle}
      className={`nav-sheet absolute inset-x-3 z-10 rounded-3xl bg-surface/95 p-4 shadow-xl ring-1 ring-line backdrop-blur ${
        placement === "top" ? "top-3" : "bottom-3"
      }`}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="grid size-12 shrink-0 place-items-center rounded-2xl bg-you text-white shadow-md shadow-you/30"
        >
          <Navigation aria-hidden className="size-6" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg leading-tight font-semibold">{t.navTitle}</h2>
          <p className="mt-0.5 text-sm text-muted">{t.navFacingHint}</p>
        </div>
      </div>

      {problem && (
        <p role="alert" className="mt-3 flex items-center gap-2 rounded-xl bg-danger-soft px-3 py-2 text-sm font-medium text-danger">
          <CircleAlert aria-hidden className="size-4 shrink-0" />
          {problem}
        </p>
      )}

      {canTry && (
        <button
          type="button"
          onClick={onStart}
          disabled={isAsking}
          className="mt-3 flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-you text-lg font-semibold text-white shadow-lg shadow-you/30 transition active:scale-[0.98] disabled:opacity-80"
        >
          {isAsking ? (
            <LoaderCircle aria-hidden className="size-5 animate-spin" />
          ) : (
            <Navigation aria-hidden className="size-5" />
          )}
          {isAsking ? t.liveRequesting : t.navStart}
        </button>
      )}
      <button
        type="button"
        onClick={onDismiss}
        className="mt-1 h-11 w-full rounded-xl text-sm font-medium text-muted hover:bg-paper"
      >
        {t.navNotNow}
      </button>
    </section>
  );
}

interface NavigationHudProps {
  status: PositioningStatus;
  onStop: () => void;
  /** Adding an item mid-trip re-plans from the dot, so the search bar stays one tap away. */
  onSearch?: () => void;
}

/** While navigating: that it's live, a way to add an item, and the way out. Nothing else. */
export function NavigationHud({ status, onStop, onSearch }: NavigationHudProps) {
  const { t } = useLanguage();
  const isAiming = status === "calibrating";
  return (
    <div className="pointer-events-none absolute inset-x-3 top-3 z-10 flex items-center justify-between gap-2">
      <p
        role="status"
        className="flex h-10 items-center gap-2 rounded-full bg-ink/85 px-4 text-sm font-semibold text-white shadow-lg backdrop-blur"
      >
        <span aria-hidden className="relative flex size-2.5">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-you opacity-75" />
          <span className="relative inline-flex size-2.5 rounded-full bg-[#60a5fa]" />
        </span>
        {isAiming ? t.navAiming : t.navActive}
      </p>
      <span className="flex gap-2">
        {onSearch && (
          <button
            type="button"
            onClick={onSearch}
            aria-label={t.navAddItem}
            className="pointer-events-auto grid size-11 place-items-center rounded-full bg-surface/95 text-ink shadow-lg ring-1 ring-line backdrop-blur"
          >
            <Search aria-hidden className="size-5" />
          </button>
        )}
        <button
          type="button"
          onClick={onStop}
          className="pointer-events-auto flex h-11 items-center gap-1.5 rounded-full bg-surface/95 px-4 text-sm font-semibold text-ink shadow-lg ring-1 ring-line backdrop-blur"
        >
          <X aria-hidden className="size-4" />
          {t.navEnd}
        </button>
      </span>
    </div>
  );
}
