import { Languages } from "lucide-react";

import { useLanguage } from "../i18n/LanguageProvider";

interface LanguageToggleProps {
  className?: string;
  /** Takes less room, for the phone's search row. */
  compact?: boolean;
}

export function LanguageToggle({ className = "", compact = false }: LanguageToggleProps) {
  const { t, toggleLanguage } = useLanguage();

  return (
    <button
      type="button"
      onClick={toggleLanguage}
      aria-label={t.otherLanguageLabel}
      className={`inline-flex items-center gap-2 rounded-full font-medium transition-colors ${
        compact ? "justify-center text-muted" : "bg-surface px-4 ring-1 ring-line hover:bg-brand-soft"
      } ${className}`}
    >
      {!compact && <Languages aria-hidden className="size-[1.1em] text-muted" />}
      {compact ? t.otherLanguageShort : t.otherLanguageLabel}
    </button>
  );
}
