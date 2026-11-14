import { LoaderCircle } from "lucide-react";
import type { FormEvent } from "react";
import { useState } from "react";

import { checkAdminToken } from "../../api/adminClient";
import { ApiError } from "../../api/client";
import { useLanguage } from "../../i18n/LanguageProvider";
import { LanguageToggle } from "../LanguageToggle";
import { Notice } from "../Notice";

interface AdminLoginProps {
  onSignedIn: (token: string) => void;
  /** The staff app signs in here too, with its own heading and check. */
  title?: string;
  check?: (token: string) => Promise<void>;
}

export function AdminLogin({ onSignedIn, title, check = checkAdminToken }: AdminLoginProps) {
  const { t } = useLanguage();
  const [token, setToken] = useState("");
  const [isChecking, setIsChecking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const entered = token.trim();
    setIsChecking(true);
    setProblem(null);
    try {
      await check(entered);
      onSignedIn(entered);
    } catch (error) {
      const status = error instanceof ApiError ? error.status : 0;
      setProblem(
        status === 401 ? t.adminWrongToken : status === 503 ? t.adminLocked : t.adminSignInFailed,
      );
    } finally {
      setIsChecking(false);
    }
  };

  return (
    <div className="min-h-dvh bg-paper text-ink">
      <header className="bg-slate-900 text-white">
        <div className="mx-auto flex max-w-md items-center justify-between gap-2 px-4 pt-[calc(0.75rem+env(safe-area-inset-top))] pb-3">
          <span className="text-lg font-semibold">{t.direction === "rtl" ? "שפע" : "Shefa"}</span>
          <LanguageToggle compact className="h-10 min-w-10 bg-white/10 px-3 text-white ring-1 ring-white/20" />
        </div>
      </header>
      <main className="mx-auto flex max-w-md flex-col px-4 pt-10">
        <form
          onSubmit={(event) => void submit(event)}
          className="flex flex-col gap-4 rounded-3xl bg-surface p-5 shadow-sm ring-1 ring-line"
        >
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{title ?? t.adminTitle}</h1>
            <p className="text-muted">{t.adminSignInHint}</p>
          </div>
          <label className="flex flex-col gap-1.5 font-semibold">
            {t.adminTokenLabel}
            <input
              type="password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              autoComplete="current-password"
              required
              className="h-14 rounded-2xl bg-paper px-4 text-lg font-normal ring-1 ring-line outline-none focus:bg-surface focus:ring-2 focus:ring-brand"
            />
          </label>
          {problem && <Notice message={problem} />}
          <button
            type="submit"
            disabled={isChecking || !token.trim()}
            className="flex h-14 items-center justify-center gap-2 rounded-2xl bg-brand text-lg font-semibold text-white shadow-sm disabled:opacity-40"
          >
            {isChecking && <LoaderCircle aria-hidden className="size-5 animate-spin" />}
            {t.adminSignIn}
          </button>
        </form>
      </main>
    </div>
  );
}
