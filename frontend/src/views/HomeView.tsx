import {
  ArrowUpLeft,
  BellRing,
  ChartColumnIncreasing,
  LayoutDashboard,
  MapPinned,
  Monitor,
  Smartphone,
  Store,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useEffect } from "react";
import { Link } from "react-router";

import { publicOrigin } from "../components/kiosk/publicOrigin";
import { LanguageToggle } from "../components/LanguageToggle";
import { useLanguage } from "../i18n/LanguageProvider";
import { buildMobileUrl } from "../lib/shareUrl";

const VALUE_ICONS: readonly LucideIcon[] = [MapPinned, BellRing, ChartColumnIncreasing];

interface Screen {
  key: "kiosk" | "mobile" | "staff" | "admin";
  path: string;
  icon: LucideIcon;
}

const SCREENS: readonly Screen[] = [
  { key: "kiosk", path: "/kiosk", icon: Monitor },
  { key: "mobile", path: "/mobile", icon: Smartphone },
  { key: "staff", path: "/staff", icon: BellRing },
  { key: "admin", path: "/admin", icon: LayoutDashboard },
];

/**
 * The product on one page, for a meeting with a chain: what it does in a sentence,
 * the three things a store gets, each screen a tap away with who it's for, a code to
 * try the shopper's phone on the spot, and the pilot offer.
 */
export default function HomeView() {
  const { t, language } = useLanguage();
  const home = t.home;
  const tryUrl = buildMobileUrl(publicOrigin(), [], language);

  useEffect(() => {
    const before = document.title;
    document.title = home.pageTitle;
    return () => {
      document.title = before;
    };
  }, [home.pageTitle]);

  return (
    <div dir={t.direction} className="min-h-dvh bg-paper text-ink">
      <header className="bg-slate-900 text-white">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-5 pt-[calc(1rem+env(safe-area-inset-top))] pb-4">
          <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-brand shadow-lg shadow-black/30">
            <Store aria-hidden className="size-6" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-xl leading-tight font-bold">{home.brand}</p>
            <p className="truncate text-sm text-white/60">{home.tagline}</p>
          </div>
          <LanguageToggle compact className="h-10 min-w-10 rounded-full bg-white/10 px-3 text-white ring-1 ring-white/20" />
        </div>
      </header>

      <main className="mx-auto flex max-w-6xl flex-col gap-6 px-5 py-8 sm:py-10">
        <section className="flex flex-col gap-4">
          <h1 className="max-w-3xl text-[clamp(2rem,5vw,3.25rem)] leading-[1.1] font-bold tracking-tight text-balance">
            {home.title}
          </h1>
          <p className="max-w-2xl text-lg leading-relaxed text-muted sm:text-xl">{home.lead}</p>
        </section>

        <ul className="grid gap-3 sm:grid-cols-3">
          {home.values.map((value, index) => {
            const Icon = VALUE_ICONS[index] ?? MapPinned;
            return (
              <li key={value.title} className="flex gap-3 rounded-3xl bg-surface p-5 shadow-sm ring-1 ring-line">
                <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-brand-soft text-brand">
                  <Icon aria-hidden className="size-5" />
                </span>
                <span>
                  <span className="block text-lg font-semibold">{value.title}</span>
                  <span className="mt-0.5 block leading-snug text-muted">{value.text}</span>
                </span>
              </li>
            );
          })}
        </ul>

        <section aria-labelledby="screens-title" className="flex flex-col gap-3">
          <h2 id="screens-title" className="text-2xl font-semibold">
            {home.screensTitle}
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {SCREENS.map(({ key, path, icon: Icon }) => (
              <li key={key}>
                <Link
                  to={path}
                  data-screen={key}
                  className="group flex h-full flex-col gap-3 rounded-3xl bg-surface p-5 shadow-sm ring-1 ring-line transition hover:ring-2 hover:ring-brand"
                >
                  <span className="flex items-center justify-between">
                    <span className="grid size-12 place-items-center rounded-2xl bg-slate-900 text-white">
                      <Icon aria-hidden className="size-6" />
                    </span>
                    <ArrowUpLeft aria-hidden className="size-5 text-muted transition group-hover:text-brand ltr:-scale-x-100" />
                  </span>
                  <span>
                    <span className="block text-lg font-semibold">{home.screens[key].title}</span>
                    <span className="mt-0.5 block text-sm font-medium text-brand-strong">{home.screens[key].who}</span>
                    <span className="mt-2 block leading-snug text-muted">{home.screens[key].text}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          <div className="flex items-center gap-4 rounded-3xl bg-surface p-5 shadow-sm ring-1 ring-line">
            <div className="shrink-0 rounded-2xl bg-white p-1 ring-1 ring-line">
              <QRCodeSVG value={tryUrl} size={512} level="M" marginSize={2} title={home.tryTitle} className="block size-28" />
            </div>
            <div>
              <p className="text-lg font-semibold">{home.tryTitle}</p>
              <p className="mt-1 leading-snug text-muted">{home.tryText}</p>
            </div>
          </div>
          <div className="relative isolate overflow-hidden rounded-3xl bg-brand-strong p-6 text-white shadow-lg shadow-brand-strong/20">
            <span aria-hidden className="absolute -end-16 -top-20 -z-10 size-64 rounded-full bg-brand/50 blur-3xl" />
            <p className="font-semibold text-next">{home.pilotKicker}</p>
            <p className="mt-1 text-2xl leading-tight font-bold text-balance">{home.pilotTitle}</p>
            <p className="mt-2 leading-snug text-white/80">{home.pilotText}</p>
          </div>
        </section>
      </main>
    </div>
  );
}
