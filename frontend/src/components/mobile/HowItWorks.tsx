import { ListChecks, Route, ScrollText } from "lucide-react";

import { useLanguage } from "../../i18n/LanguageProvider";

const ICONS = [ScrollText, Route, ListChecks];

/**
 * What the app does, in three steps, for someone who just scanned the code at the
 * door and has never seen it: a list, a route through the store, and one button.
 */
export function HowItWorks() {
  const { t } = useLanguage();

  return (
    <section aria-labelledby="how-title" className="rounded-3xl bg-surface p-4 shadow-sm ring-1 ring-line">
      <h2 id="how-title" className="sr-only">
        {t.howTitle}
      </h2>
      <ol className="grid grid-cols-3 gap-2">
        {t.howSteps.map((step, index) => {
          const Icon = ICONS[index] ?? ListChecks;
          return (
            <li key={step.title} className="flex flex-col items-center gap-1.5 text-center">
              <span className="relative grid size-11 place-items-center rounded-2xl bg-brand-soft text-brand">
                <Icon aria-hidden className="size-5" />
                <span className="absolute -end-1.5 -top-1.5 grid size-5 place-items-center rounded-full bg-slate-900 text-[0.7rem] font-bold text-white">
                  {index + 1}
                </span>
              </span>
              <span className="font-semibold leading-tight">{step.title}</span>
              <span className="text-xs leading-snug text-muted">{step.hint}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
