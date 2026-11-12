import { Smartphone } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useId } from "react";

import { useLanguage } from "../../i18n/LanguageProvider";
import { buildMobileUrl } from "../../lib/shareUrl";
import { publicOrigin } from "./publicOrigin";

interface KioskQrCardProps {
  /** What was picked here, so scanning carries it over. Usually empty. */
  categoryIds: readonly string[];
  className?: string;
}

/**
 * The way on to the phone: the code, and why to scan it. About 5 cm across on a
 * 12.9" tablet, which a phone reads from half a metre; the white margin is part of
 * the code, since scanners need that quiet zone.
 */
export function KioskQrCard({ categoryIds, className = "" }: KioskQrCardProps) {
  const { t, language } = useLanguage();
  const titleId = useId();
  const url = buildMobileUrl(publicOrigin(), categoryIds, language);
  const carriesItems = categoryIds.length > 0;

  return (
    <section
      aria-labelledby={titleId}
      className={`relative isolate flex shrink-0 items-center gap-[clamp(1rem,2.2vh,1.75rem)] overflow-hidden rounded-[2rem] bg-brand-strong p-[clamp(1rem,2.2vh,1.5rem)] text-white shadow-lg shadow-brand-strong/20 ${className}`}
    >
      {/* A soft light behind the words, so the card reads as one piece rather than a flat slab. */}
      <span aria-hidden className="absolute -end-20 -top-24 -z-10 size-72 rounded-full bg-brand/50 blur-3xl" />
      <div data-qr className="shrink-0 rounded-2xl bg-white shadow-xl shadow-black/20">
        <QRCodeSVG
          value={url}
          size={1024}
          level="M"
          marginSize={3}
          fgColor="#000000"
          bgColor="#ffffff"
          title={t.kioskScanTitle}
          className="block size-[clamp(10rem,23vh,15rem)] rounded-2xl portrait:size-[clamp(9rem,13.5vh,12rem)]"
        />
      </div>
      <div className="flex min-w-0 flex-col gap-[0.9vh]">
        <p className="text-[clamp(1rem,2.1vh,1.3rem)] font-semibold text-next">
          {carriesItems ? t.kioskQrKickerItems : t.kioskQrKicker}
        </p>
        <h2 id={titleId} className="text-[clamp(1.3rem,2.8vh,1.9rem)] leading-tight font-bold text-balance">
          {t.kioskScanTitle}
        </h2>
        <p className="flex items-start gap-2 text-[clamp(1rem,2vh,1.25rem)] leading-snug text-white/80">
          <Smartphone aria-hidden className="mt-0.5 size-[1.15em] shrink-0" />
          {carriesItems ? t.kioskScanItems : t.kioskScanHow}
        </p>
      </div>
    </section>
  );
}
