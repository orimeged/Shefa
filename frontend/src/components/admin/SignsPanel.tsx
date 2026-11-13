import { CheckSquare, Printer, Square } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";

import { useLanguage } from "../../i18n/LanguageProvider";
import type { ShelfOption } from "../../lib/admin/catalog";
import type { SignSpec } from "../../lib/admin/signs";
import { signSpecs } from "../../lib/admin/signs";
import { publicOrigin } from "../kiosk/publicOrigin";

interface SignsPanelProps {
  /** The drawn plan's shelves; null when the store has no plan that routes. */
  shelves: readonly ShelfOption[] | null;
}

/**
 * Printable QR signs: one for the entrance, one for each aisle end. A shelf's sign
 * also tells the phone where the shopper stands, so the route starts from there.
 * A sign is what most shoppers will ever see of the system: it promises one thing.
 */
export function SignsPanel({ shelves }: SignsPanelProps) {
  const { t } = useLanguage();
  const labels = useMemo(() => [...new Set((shelves ?? []).map((shelf) => shelf.label))], [shelves]);
  // What a manager unticked: a shelf drawn later starts ticked, like every other.
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(() => new Set());
  const [withEntrance, setWithEntrance] = useState(true);
  const origin = publicOrigin();
  const specs = signSpecs(
    origin,
    labels.filter((label) => !excluded.has(label)),
    withEntrance,
  );

  const toggle = (label: string) =>
    setExcluded((current) => {
      const next = new Set(current);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });

  return (
    <section aria-labelledby="signs-title" className="flex flex-col gap-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="signs-title" className="text-lg font-semibold">
            {t.signsTitle}
          </h2>
          <p className="max-w-2xl text-sm text-slate-500">{t.signsHint}</p>
        </div>
        <button
          type="button"
          onClick={() => window.print()}
          disabled={specs.length === 0}
          className="flex h-11 items-center gap-2 rounded-full bg-brand px-5 font-semibold text-white shadow-sm disabled:opacity-50"
        >
          <Printer aria-hidden className="size-5" />
          {t.signsPrint(specs.length)}
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        <Choice isOn={withEntrance} onToggle={() => setWithEntrance((on) => !on)} label={t.signsEntrance} />
        {labels.map((label) => (
          <Choice key={label} isOn={!excluded.has(label)} onToggle={() => toggle(label)} label={label} />
        ))}
      </div>
      {labels.length === 0 && <p className="text-sm text-slate-500">{t.signsNoPlan}</p>}

      {/* On screen: a preview of the first ones. Printed: every sign, two to an A4 page. */}
      <div className="grid gap-4 lg:grid-cols-2">
        {specs.slice(0, 4).map((spec) => (
          <div key={spec.key} className="overflow-hidden rounded-xl ring-1 ring-slate-200">
            <Sign spec={spec} />
          </div>
        ))}
      </div>

      {createPortal(
        <div data-print-signs className="print-signs">
          {specs.map((spec) => (
            <Sign key={spec.key} spec={spec} />
          ))}
        </div>,
        document.body,
      )}
    </section>
  );
}

function Choice({ isOn, onToggle, label }: { isOn: boolean; onToggle: () => void; label: string }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={isOn}
      onClick={onToggle}
      className={`flex h-10 items-center gap-1.5 rounded-full px-3.5 text-sm font-medium ring-1 ${
        isOn ? "bg-brand-soft text-brand-strong ring-brand/40" : "bg-white text-slate-500 ring-slate-300"
      }`}
    >
      {isOn ? <CheckSquare aria-hidden className="size-4" /> : <Square aria-hidden className="size-4" />}
      {label}
    </button>
  );
}

/** One sign, in Hebrew whatever the dashboard's language: it hangs in an Israeli store. */
function Sign({ spec }: { spec: SignSpec }) {
  const isEntrance = spec.shelf === null;
  return (
    <article data-sign={spec.shelf ?? "entrance"} dir="rtl" lang="he" className="sign">
      <div className="sign-text">
        <p className="sign-brand">מסלול קניות</p>
        <h3 className="sign-headline">{isEntrance ? "יש לכם רשימת קניות?" : "לא מוצאים מוצר?"}</h3>
        <p className="sign-body">סרקו ושלחו את הרשימה מהוואטסאפ. נסדר אותה לפי המעברים בסניף.</p>
        <p className="sign-footer">{isEntrance ? "בלי אפליקציה ובלי הרשמה" : `אתם כאן: מדף ${spec.shelf}`}</p>
      </div>
      <div className="sign-code">
        <QRCodeSVG value={spec.url} size={512} level="M" marginSize={2} className="sign-qr" title={spec.url} />
      </div>
    </article>
  );
}
