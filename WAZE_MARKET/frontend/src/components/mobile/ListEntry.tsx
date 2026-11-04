import { Camera, ClipboardPaste, LoaderCircle, PenLine, X } from "lucide-react";
import type { ChangeEvent } from "react";
import { useCallback, useRef, useState } from "react";

import { useListPhoto } from "../../hooks/useListPhoto";
import { useLanguage } from "../../i18n/LanguageProvider";
import { readClipboard } from "../../lib/list/clipboard";
import { parseShoppingText } from "../../lib/list/parseList";

const CHOICE =
  "flex h-16 min-w-0 items-center justify-center gap-2.5 rounded-2xl bg-surface px-2 font-semibold shadow-sm";
const QUIET =
  "flex h-11 items-center gap-1.5 rounded-xl px-2 text-sm font-medium text-muted disabled:opacity-50";

interface ListEntryProps {
  onAddText: (text: string) => void;
}

/**
 * A whole list at once, typed, pasted or photographed. It all lands in one box to
 * check before adding, because handwriting gets misread and only the shopper can
 * tell. The sheet opens from the top, where the keyboard can't cover its button.
 */
export function ListEntry({ onAddText }: ListEntryProps) {
  const { t } = useLanguage();
  const [isOpen, setIsOpen] = useState(false);
  const [text, setText] = useState("");
  const [pasteFailed, setPasteFailed] = useState(false);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const pickerRef = useRef<HTMLInputElement>(null);

  const appendLines = useCallback((lines: readonly string[]) => {
    setText((current) => [current.trim(), ...lines].filter(Boolean).join("\n"));
  }, []);
  const photo = useListPhoto(appendLines);

  const count = parseShoppingText(text).length;
  const isReading = photo.status === "reading";
  const notice =
    photo.status === "unreadable"
      ? t.photoUnreadable
      : photo.status === "unavailable"
        ? t.photoUnavailable
        : pasteFailed
          ? t.pasteHint
          : null;

  // What was written stays: a stray tap outside shouldn't cost a typed list.
  const close = () => {
    photo.reset();
    setPasteFailed(false);
    setIsOpen(false);
  };

  const add = () => {
    onAddText(text);
    setText("");
    close();
  };

  const pasteFromClipboard = async () => {
    const pasted = await readClipboard();
    setPasteFailed(pasted === null);
    if (pasted === null) {
      fieldRef.current?.focus();
    } else {
      appendLines([pasted]);
    }
  };

  const handlePicked = (event: ChangeEvent<HTMLInputElement>) => {
    const picked = event.target.files?.[0];
    // Otherwise choosing the same photo again wouldn't count as a change.
    event.target.value = "";
    if (picked) {
      setPasteFailed(false);
      setIsOpen(true);
      void photo.read(picked);
    }
  };

  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <button type="button" onClick={() => setIsOpen(true)} className={CHOICE}>
          <PenLine aria-hidden className="size-5 shrink-0 text-brand-strong" />
          {t.listEntryWrite}
        </button>
        <button type="button" onClick={() => pickerRef.current?.click()} className={CHOICE}>
          <Camera aria-hidden className="size-5 shrink-0 text-brand-strong" />
          {t.listEntryPhoto}
        </button>
      </div>

      {/* No `capture`: a list may already be a photo or a screenshot in the gallery. */}
      <input
        ref={pickerRef}
        type="file"
        accept="image/*"
        aria-label={t.listEntryPhoto}
        onChange={handlePicked}
        className="hidden"
      />

      {isOpen && (
        <>
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            onClick={close}
            className="fixed inset-0 z-40 bg-ink/40"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t.listEntryTitle}
            className="fixed inset-x-0 top-0 z-50 mx-auto flex max-h-dvh max-w-xl flex-col gap-3 overflow-y-auto rounded-b-[2rem] bg-paper px-4 pt-[calc(0.75rem+env(safe-area-inset-top))] pb-5 shadow-xl"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">{t.listEntryTitle}</h2>
              <button
                type="button"
                onClick={close}
                aria-label={t.closePanel}
                className="-me-2 grid size-11 place-items-center rounded-xl text-muted"
              >
                <X aria-hidden className="size-5" />
              </button>
            </div>

            {(photo.preview || isReading) && (
              <div className="flex items-center gap-3">
                {photo.preview ? (
                  <img
                    src={photo.preview}
                    alt={t.listEntryPhoto}
                    className="size-16 shrink-0 rounded-xl object-cover"
                  />
                ) : (
                  <span className="size-16 shrink-0 animate-pulse rounded-xl bg-line" />
                )}
                <p role="status" className="flex min-w-0 items-center gap-2 font-medium">
                  {isReading && <LoaderCircle aria-hidden className="size-4 shrink-0 animate-spin" />}
                  {isReading ? t.photoReading : photo.status === "read" ? t.photoReview : null}
                </p>
              </div>
            )}

            {notice && (
              <p role="status" className="rounded-2xl bg-next-soft px-4 py-2.5 font-medium">
                {notice}
              </p>
            )}

            <textarea
              ref={fieldRef}
              // A photo opens the sheet to read, not to type, so the keyboard stays down.
              autoFocus={photo.status === "idle"}
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder={t.listEntryPlaceholder}
              aria-label={t.listEntryTitle}
              autoComplete="off"
              className="h-[26dvh] min-h-36 w-full resize-none rounded-2xl bg-surface p-4 text-lg leading-relaxed outline-none placeholder:text-muted"
            />

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void pasteFromClipboard()}
                className={QUIET}
              >
                <ClipboardPaste aria-hidden className="size-4" />
                {t.pasteShort}
              </button>
              <button
                type="button"
                onClick={() => pickerRef.current?.click()}
                disabled={isReading}
                className={QUIET}
              >
                <Camera aria-hidden className="size-4" />
                {t.listEntryPhoto}
              </button>
            </div>

            <button
              type="button"
              onClick={add}
              disabled={count === 0}
              className="h-14 shrink-0 rounded-2xl bg-brand text-lg font-semibold text-white transition-colors disabled:bg-line disabled:text-muted"
            >
              {t.addItems(count)}
            </button>
          </div>
        </>
      )}
    </>
  );
}
