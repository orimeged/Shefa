import { Check, SearchX } from "lucide-react";
import { useRef, useState } from "react";

import type { RouteStop } from "../../api/types";
import { useLanguage } from "../../i18n/LanguageProvider";
import { FoundBurst } from "./FoundBurst";

const DOUBLE_TAP_MS = 500;

interface StopActionsProps {
  stop: RouteStop;
  onFound: (categoryId: string) => void;
  onNotFound: (stop: RouteStop) => void;
}

/**
 * The two answers to a stop, pinned where a thumb rests: the other hand is on
 * the cart.
 */
export function StopActions({ stop, onFound, onNotFound }: StopActionsProps) {
  const { t } = useLanguage();
  const answeredAt = useRef(-Infinity);
  const [pops, setPops] = useState(0);

  // The next stop lands under the same thumb, and a double tap mustn't answer it
  // too: not found would alert a manager about a full shelf.
  const answer = (respond: () => void) => {
    const now = performance.now();
    if (now - answeredAt.current >= DOUBLE_TAP_MS) {
      answeredAt.current = now;
      respond();
    }
  };

  return (
    <div className="fixed inset-x-0 bottom-0 z-20 mx-auto max-w-xl border-t border-line bg-paper/95 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() =>
            answer(() => {
              setPops((count) => count + 1);
              onFound(stop.category_id);
            })
          }
          className="relative flex h-16 min-w-0 flex-1 items-center justify-center gap-2 rounded-2xl bg-brand text-2xl font-semibold text-white shadow-md transition-colors active:bg-brand-strong"
        >
          {/* Keys of their own: siblings sharing one made React keep every old check. */}
          <Check
            key={`check-${pops}`}
            aria-hidden
            className={`size-7 ${pops > 0 ? "check-pop" : ""}`}
            strokeWidth={3}
          />
          {t.foundIt}
          {pops > 0 && <FoundBurst key={`burst-${pops}`} />}
        </button>
        <button
          type="button"
          onClick={() => answer(() => onNotFound(stop))}
          className="flex h-16 w-28 shrink-0 flex-col items-center justify-center gap-0.5 rounded-2xl bg-surface text-sm font-semibold text-danger ring-1 ring-danger/40"
        >
          <SearchX aria-hidden className="size-5" />
          {t.notFoundHere}
        </button>
      </div>
    </div>
  );
}
