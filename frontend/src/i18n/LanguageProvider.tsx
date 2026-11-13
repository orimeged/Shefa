import type { ReactNode } from "react";
import { createContext, use, useEffect, useMemo, useState } from "react";

import { translatedName } from "./names";
import type { Language, Strings } from "./strings";
import { DEFAULT_LANGUAGE, SHOPPER_LANGUAGES, strings } from "./strings";

interface LanguageValue {
  language: Language;
  /** Hebrew and English back and forth, for the staff screens. */
  toggleLanguage: () => void;
  /** Any of the shoppers' four. */
  setLanguage: (language: Language) => void;
  /** Back to the language the page opened in, for the next person at a shared screen. */
  resetLanguage: () => void;
  t: Strings;
  /**
   * Picks the name for the active language from a backend pair. Arabic and Russian
   * look the Hebrew name up, and fall back to the English one.
   */
  pick: (hebrew: string, english: string) => string;
}

const LanguageContext = createContext<LanguageValue | null>(null);

function languageFromUrl(): Language {
  const value = new URLSearchParams(window.location.search).get("lang");
  return SHOPPER_LANGUAGES.find((language) => language === value) ?? DEFAULT_LANGUAGE;
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState(languageFromUrl);

  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dir = strings[language].direction;
    document.title = strings[language].appName;
  }, [language]);

  const value = useMemo<LanguageValue>(
    () => ({
      language,
      toggleLanguage: () => setLanguage((current) => (current === "he" ? "en" : "he")),
      setLanguage,
      resetLanguage: () => setLanguage(languageFromUrl()),
      t: strings[language],
      pick: (hebrew, english) =>
        language === "he"
          ? hebrew
          : language === "en"
            ? english
            : (translatedName(hebrew, language) ?? english),
    }),
    [language],
  );

  return <LanguageContext value={value}>{children}</LanguageContext>;
}

export function useLanguage(): LanguageValue {
  const value = use(LanguageContext);
  if (!value) {
    throw new Error("useLanguage must be used inside LanguageProvider");
  }
  return value;
}
