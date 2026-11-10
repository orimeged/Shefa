import { useEffect } from "react";

const VISIBLE_MS = 4000;

interface ToastProps {
  message: string;
  onDismiss: () => void;
  /** Lifts it clear of the button pinned to the bottom of the list. */
  aboveAction?: boolean;
  /** Or exactly this many pixels up, clear of something taller, such as the station sheet. */
  offsetPx?: number;
}

export function Toast({ message, onDismiss, aboveAction = false, offsetPx }: ToastProps) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [message, onDismiss]);

  return (
    <p
      role="status"
      className={`fixed inset-x-4 z-30 mx-auto max-w-lg rounded-2xl bg-ink px-4 py-3 text-center font-medium text-white shadow-lg ${
        offsetPx !== undefined
          ? ""
          : aboveAction
            ? "bottom-[calc(6rem+env(safe-area-inset-bottom))]"
            : "bottom-[calc(1rem+env(safe-area-inset-bottom))]"
      }`}
      style={offsetPx !== undefined ? { bottom: `calc(${offsetPx + 12}px + env(safe-area-inset-bottom))` } : undefined}
    >
      {message}
    </p>
  );
}
