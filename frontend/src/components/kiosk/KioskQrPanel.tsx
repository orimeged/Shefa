import { MapPinned, TriangleAlert } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";

import { useLanguage } from "../../i18n/LanguageProvider";
import { buildMobileUrl, isReachableFromPhone } from "../../lib/shareUrl";
import { publicOrigin } from "./publicOrigin";

interface KioskQrPanelProps {
  storeName: string | null;
  /** What was picked on the right, so scanning carries it over. Usually empty. */
  categoryIds: readonly string[];
  screenCanStayOn: boolean;
}

export function KioskQrPanel({ storeName, categoryIds, screenCanStayOn }: KioskQrPanelProps) {
  const { t, language } = useLanguage();
  const origin = publicOrigin();
  const url = buildMobileUrl(origin, categoryIds, language);

  return (
    <section
      dir={t.direction}
      className="flex min-h-0 flex-col items-center justify-center gap-[1.5vh] overflow-hidden bg-brand-strong p-[2vh] text-center text-white portrait:gap-[1vh] portrait:p-[1vh]"
    >
      <p className="flex items-center gap-2 text-[max(1rem,2.2vh)] font-medium text-white/85 portrait:hidden">
        <MapPinned aria-hidden className="size-[1.3em]" />
        {t.appName}
        {storeName && ` · ${storeName}`}
      </p>

      {/* The white margin around the code is part of it: scanners need that quiet zone. */}
      <div className="rounded-3xl bg-white shadow-2xl">
        <QRCodeSVG
          value={url}
          size={1024}
          level="M"
          marginSize={3}
          fgColor="#000000"
          bgColor="#ffffff"
          title={t.kioskScanTitle}
          className="block size-[max(40vh,min(62vh,44vw))] rounded-3xl portrait:size-[40vh]"
        />
      </div>

      <h1 className="max-w-[46rem] leading-tight font-bold text-balance landscape:text-[min(4.8vh,2.5vw)] portrait:text-[2.5vh]">
        {t.kioskScanTitle}
      </h1>
      {categoryIds.length > 0 && (
        <p className="text-[max(1rem,2.2vh)] text-white/85 portrait:hidden">{t.kioskScanItems}</p>
      )}

      {!isReachableFromPhone(origin) && <SetupWarning message={t.qrUnreachable} />}
      {!screenCanStayOn && <SetupWarning message={t.screenMaySleep} />}
    </section>
  );
}

/** For whoever sets the tablet up. A live store never shows these. */
function SetupWarning({ message }: { message: string }) {
  return (
    <p
      role="alert"
      className="flex items-center gap-2 rounded-xl bg-next-soft px-3 py-1.5 text-start font-medium text-ink"
    >
      <TriangleAlert aria-hidden className="size-5 shrink-0" />
      {message}
    </p>
  );
}
