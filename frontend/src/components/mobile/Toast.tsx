import { useEffect } from "react";

const VISIBLE_MS = 4000;

interface ToastProps {
  message: string;
  onDismiss: () => void;
  /** Lifts it clear of the button pinned to the bottom of the list. */
  aboveAction?: boolean;
}

export function Toast({ message, onDismiss, aboveAction = false }: ToastProps) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [message, onDismiss]);

  return (
    <p
      role="status"
      className={`fixed inset-x-4 z-30 mx-auto max-w-lg rounded-2xl bg-ink px-4 py-3 text-center font-medium text-white shadow-lg ${
        aboveAction
          ? "bottom-[calc(6rem+env(safe-area-inset-bottom))]"
          : "bottom-[calc(1rem+env(safe-area-inset-bottom))]"
      }`}
    >
      {message}
    </p>
  );
}
