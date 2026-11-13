import { Check, Languages } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useLanguage } from "../i18n/LanguageProvider";
import type { Language } from "../i18n/strings";
import { LANGUAGE_NAMES, SHOPPER_LANGUAGES } from "../i18n/strings";

interface LanguagePickerProps {
  className?: string;
  /** Takes less room, for the phone's search row. */
  compact?: boolean;
}

/**
 * The shoppers' language: Hebrew, Arabic, Russian or English, each named in itself
 * so someone who reads only one of them can still find it.
 */
export function LanguagePicker({ className = "", compact = false }: LanguagePickerProps) {
  const { language, setLanguage } = useLanguage();
  const [isOpen, setIsOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setIsOpen(false);
    };
    const escape = (event: KeyboardEvent) => event.key === "Escape" && setIsOpen(false);
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [isOpen]);

  const choose = (next: Language) => {
    setLanguage(next);
    setIsOpen(false);
  };

  return (
    <div ref={root} className="relative shrink-0">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label="שפה · اللغة · Язык · Language"
        onClick={() => setIsOpen((open) => !open)}
        className={`inline-flex items-center gap-2 rounded-full font-medium transition-colors ${
          compact ? "justify-center text-muted" : "bg-surface px-4 ring-1 ring-line hover:bg-brand-soft"
        } ${className}`}
      >
        <Languages aria-hidden className="size-[1.1em] text-muted" />
        {!compact && LANGUAGE_NAMES[language]}
      </button>
      {isOpen && (
        <ul
          role="menu"
          className="absolute end-0 top-full z-50 mt-2 min-w-44 overflow-hidden rounded-2xl bg-surface py-1 text-base shadow-xl ring-1 ring-line"
        >
          {SHOPPER_LANGUAGES.map((option) => (
            <li key={option} role="none">
              <button
                type="button"
                role="menuitemradio"
                aria-checked={option === language}
                lang={option}
                dir={option === "he" || option === "ar" ? "rtl" : "ltr"}
                onClick={() => choose(option)}
                className="flex min-h-12 w-full items-center gap-3 px-4 text-start font-medium text-ink hover:bg-brand-soft"
              >
                <span className="flex-1">{LANGUAGE_NAMES[option]}</span>
                {option === language && <Check aria-hidden className="size-4 text-brand" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
