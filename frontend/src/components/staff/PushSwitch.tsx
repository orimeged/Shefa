import { Bell, BellOff, BellRing, LoaderCircle, Send } from "lucide-react";
import { useState } from "react";

import { useLanguage } from "../../i18n/LanguageProvider";
import type { PushState } from "../../lib/staff/push";

interface PushSwitchProps {
  state: PushState;
  isBusy: boolean;
  onEnable: () => void;
  onDisable: () => void;
  onTest: () => Promise<{ sent: number }>;
}

/** Whether this phone rings for new alerts, and the one step to change that. */
export function PushSwitch({ state, isBusy, onEnable, onDisable, onTest }: PushSwitchProps) {
  const { t } = useLanguage();
  const [tested, setTested] = useState<string | null>(null);

  if (state === "checking") {
    return <div className="mx-4 mt-3 h-14 animate-pulse rounded-2xl bg-line/60" />;
  }

  const explanation =
    state === "install-first"
      ? t.staffPush.installFirst
      : state === "unsupported"
        ? t.staffPush.unsupported
        : state === "server-off"
          ? t.staffPush.serverOff
          : state === "denied"
            ? t.staffPush.denied
            : null;

  if (explanation) {
    return (
      <p data-push={state} className="mx-4 mt-3 flex items-start gap-2 rounded-2xl bg-next-soft px-4 py-3 text-sm ring-1 ring-next/40">
        <BellOff aria-hidden className="mt-0.5 size-4 shrink-0" />
        {explanation}
      </p>
    );
  }

  const isOn = state === "on";
  return (
    <div data-push={state} className="mx-4 mt-3 flex flex-col gap-2 rounded-2xl bg-surface px-4 py-3 ring-1 ring-line">
      <div className="flex items-center gap-3">
        {isOn ? <BellRing aria-hidden className="size-5 text-brand" /> : <Bell aria-hidden className="size-5 text-muted" />}
        <p className="flex-1 font-medium">{isOn ? t.staffPush.on : t.staffPush.off}</p>
        <button
          type="button"
          disabled={isBusy}
          onClick={isOn ? onDisable : onEnable}
          className={`flex h-10 items-center gap-1.5 rounded-full px-4 text-sm font-semibold disabled:opacity-60 ${
            isOn ? "bg-surface text-ink ring-1 ring-line" : "bg-brand text-white"
          }`}
        >
          {isBusy && <LoaderCircle aria-hidden className="size-4 animate-spin" />}
          {isOn ? t.staffPush.turnOff : t.staffPush.turnOn}
        </button>
      </div>
      {isOn && (
        <div className="flex items-center gap-2 text-sm">
          <button
            type="button"
            onClick={() => {
              setTested(null);
              onTest()
                .then((result) => setTested(t.staffPush.testSent(result.sent)))
                .catch(() => setTested(t.staffPush.testSent(0)));
            }}
            className="flex h-9 items-center gap-1.5 rounded-full px-3 font-medium text-brand-strong ring-1 ring-brand/40"
          >
            <Send aria-hidden className="size-4" />
            {t.staffPush.test}
          </button>
          {tested && <span role="status" className="text-muted">{tested}</span>}
        </div>
      )}
    </div>
  );
}
