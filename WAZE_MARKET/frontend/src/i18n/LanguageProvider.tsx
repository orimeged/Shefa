import type { ReactNode } from "react";
import { createContext, use, useEffect, useMemo, useState } from "react";

import type { Language, Strings } from "./strings";
import { DEFAULT_LANGUAGE, strings } from "./strings";

interface LanguageValue {
  language: Language;
  toggleLanguage: () => void;
  /** Back to the language the page opened in, for the next person at a shared screen. */
  resetLanguage: () => void;
  t: Strings;
  /** Picks the name for the active language from a backend pair. */
  pick: (hebrew: string, english: string) => string;
}

const LanguageContext = createContext<LanguageValue | null>(null);

function languageFromUrl(): Language {
  const value = new URLSearchParams(window.location.search).get("lang");
  return value === "he" || value === "en" ? value : DEFAULT_LANGUAGE;
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
      resetLanguage: () => setLanguage(languageFromUrl()),
      t: strings[language],
      pick: (hebrew, english) => (language === "he" ? hebrew : english),
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
