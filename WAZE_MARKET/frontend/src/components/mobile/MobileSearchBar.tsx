import { Check, ClipboardPaste, Mic, Plus, Search, X } from "lucide-react";
import type { ClipboardEvent, FormEvent, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

import type { SearchHit } from "../../api/types";
import { useCategorySearch } from "../../hooks/useCategorySearch";
import { useLanguage } from "../../i18n/LanguageProvider";
import { readClipboard } from "../../lib/list/clipboard";
import { CategoryIcon } from "../CategoryIcon";
import { LanguageToggle } from "../LanguageToggle";

// What the backend takes. A list dictated into the field can be longer than a search.
const MAX_SEARCH_LENGTH = 80;
const MAX_LINE_LENGTH = 200;

interface MobileSearchBarProps {
  sessionId: string;
  /** A list is built one item after another, so the keyboard stays up between them. */
  isBuilding: boolean;
  isListed: (hit: SearchHit) => boolean;
  micUnavailable: boolean;
  onAddHit: (hit: SearchHit) => void;
  onAddText: (text: string) => void;
  onDictate: () => void;
  onDismissMicHint: () => void;
  /** Shown when the empty field gets focus. Null while the page shows it anyway. */
  quickAddPanel: ReactNode;
}

/**
 * The one way to add to a list, always at the top of the screen, where the
 * keyboard can't cover it. Reading the clipboard and server dictation both have
 * gaps (no HTTPS, a refused prompt, no speech engine), so each falls back on the
 * field: long-press paste and the keyboard's microphone work on every phone, and
 * both land in the same parser.
 */
export function MobileSearchBar({
  sessionId,
  isBuilding,
  isListed,
  micUnavailable,
  onAddHit,
  onAddText,
  onDictate,
  onDismissMicHint,
  quickAddPanel,
}: MobileSearchBarProps) {
  const { t, pick } = useLanguage();
  const [term, setTerm] = useState("");
  const [panelOpen, setPanelOpen] = useState(false);
  const [pasteFailed, setPasteFailed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { hits, failed, isSearching } = useCategorySearch(
    term.slice(0, MAX_SEARCH_LENGTH),
    sessionId,
  );

  // The trip needs the whole screen: the map and the next stop, not the keyboard.
  useEffect(() => {
    if (!isBuilding) {
      setTerm("");
      inputRef.current?.blur();
    }
  }, [isBuilding]);

  const trimmed = term.trim();
  const showPanel = panelOpen && !trimmed && quickAddPanel !== null;
  const hint = micUnavailable ? t.micHint : pasteFailed ? t.pasteHint : null;

  const clearHint = () => {
    setPasteFailed(false);
    onDismissMicHint();
  };

  const close = () => {
    setTerm("");
    setPanelOpen(false);
    inputRef.current?.blur();
  };

  const finishAdding = () => {
    if (isBuilding) {
      setTerm("");
      inputRef.current?.focus();
    } else {
      close();
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (trimmed) {
      clearHint();
      onAddText(trimmed);
      finishAdding();
    }
  };

  const dictate = () => {
    close();
    onDictate();
  };

  const pasteFromClipboard = async () => {
    const pasted = await readClipboard();
    if (pasted === null) {
      setPasteFailed(true);
      inputRef.current?.focus();
    } else {
      clearHint();
      onAddText(pasted);
    }
  };

  const handleFieldPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const pasted = event.clipboardData.getData("text");
    if (pasted.trim()) {
      event.preventDefault();
      clearHint();
      onAddText(pasted);
      finishAdding();
    }
  };

  return (
    <>
      {(trimmed || showPanel) && (
        <button
          type="button"
          aria-hidden
          tabIndex={-1}
          onClick={close}
          className="fixed inset-0 z-10 bg-ink/30"
        />
      )}

      <div className="relative z-20">
        <form onSubmit={submit} role="search" className="flex items-center gap-1.5 px-3 py-2">
          <div className="relative min-w-0 flex-1">
            <Search
              aria-hidden
              className="pointer-events-none absolute start-3.5 top-1/2 size-5 -translate-y-1/2 text-muted"
            />
            <input
              ref={inputRef}
              value={term}
              onChange={(event) => {
                setTerm(event.target.value);
                clearHint();
              }}
              onPaste={handleFieldPaste}
              onFocus={() => setPanelOpen(!isBuilding)}
              placeholder={t.searchMobilePlaceholder}
              aria-label={t.searchLabel}
              maxLength={MAX_LINE_LENGTH}
              enterKeyHint="go"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              className="h-13 w-full rounded-full bg-surface ps-11 pe-12 text-lg shadow-sm ring-1 ring-line placeholder:text-muted"
            />
            {term ? (
              <button
                type="button"
                onClick={close}
                aria-label={t.clearSearch}
                className="absolute end-1 top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-full text-muted"
              >
                <X aria-hidden className="size-5" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void pasteFromClipboard()}
                aria-label={t.pasteList}
                className="absolute end-1 top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-full text-muted"
              >
                <ClipboardPaste aria-hidden className="size-5" />
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={dictate}
            aria-label={t.startDictation}
            className="grid size-12 shrink-0 place-items-center rounded-full bg-brand-soft text-brand-strong"
          >
            <Mic aria-hidden className="size-6" />
          </button>
          <LanguageToggle compact className="size-11 shrink-0 text-sm" />
        </form>

        {hint && (
          <p role="status" className="mx-3 mb-2 rounded-2xl bg-next-soft px-4 py-2.5 font-medium">
            {hint}
          </p>
        )}

        {trimmed && (
          <div className="absolute inset-x-0 top-full max-h-[60dvh] overflow-y-auto rounded-b-3xl bg-paper px-3 pb-3 shadow-lg">
            <ul className="flex flex-col gap-2">
              {hits.map((hit) => {
                const added = isListed(hit);
                const name = pick(hit.category_name, hit.category_name_en);
                return (
                  <li key={hit.category_id}>
                    <button
                      type="button"
                      onClick={() => {
                        onAddHit(hit);
                        finishAdding();
                      }}
                      aria-label={added ? t.alreadyAdded(name) : t.addItem(name)}
                      className="flex min-h-16 w-full items-center gap-3 rounded-2xl bg-surface px-3 py-2 text-start ring-1 ring-line"
                    >
                      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand">
                        <CategoryIcon categoryId={hit.category_id} className="size-6" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-lg font-medium">
                          {hit.matched_text}
                        </span>
                        <span className="block truncate text-sm text-muted">
                          {t.aisle(hit.aisle_no, hit.side)} · {name}
                        </span>
                      </span>
                      {added ? (
                        <Check aria-hidden className="size-6 shrink-0 text-brand" />
                      ) : (
                        <Plus aria-hidden className="size-6 shrink-0 text-brand" />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>

            {isSearching && hits.length === 0 && (
              <p role="status" className="px-2 py-3 text-muted">
                {t.searching}
              </p>
            )}
            {!isSearching && hits.length === 0 && (
              <>
                {failed && <p className="px-2 py-3 text-danger">{t.searchFailed}</p>}
                <button
                  type="button"
                  onClick={() => {
                    onAddText(trimmed);
                    finishAdding();
                  }}
                  className="flex min-h-14 w-full items-center gap-3 rounded-2xl bg-surface px-3 text-start font-medium ring-1 ring-line"
                >
                  <Plus aria-hidden className="size-6 shrink-0 text-brand" />
                  <span className="min-w-0 truncate">{t.addAnyway(trimmed)}</span>
                </button>
              </>
            )}
          </div>
        )}

        {showPanel && (
          <div className="absolute inset-x-0 top-full max-h-[70dvh] overflow-y-auto rounded-b-3xl bg-paper px-3 pt-1 pb-4 shadow-lg">
            <div className="mb-2 flex items-center justify-between px-1">
              <h2 className="font-semibold">{t.quickAdd}</h2>
              <button
                type="button"
                onClick={close}
                aria-label={t.closePanel}
                className="grid size-11 place-items-center rounded-full text-muted"
              >
                <X aria-hidden className="size-5" />
              </button>
            </div>
            {quickAddPanel}
          </div>
        )}
      </div>
    </>
  );
}
