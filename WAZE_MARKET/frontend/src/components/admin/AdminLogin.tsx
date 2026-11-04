import { LoaderCircle } from "lucide-react";
import type { FormEvent } from "react";
import { useState } from "react";

import { checkAdminToken } from "../../api/adminClient";
import { ApiError } from "../../api/client";
import { useLanguage } from "../../i18n/LanguageProvider";
import { LanguageToggle } from "../LanguageToggle";
import { Notice } from "../Notice";

export function AdminLogin({ onSignedIn }: { onSignedIn: (token: string) => void }) {
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
      await checkAdminToken(entered);
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
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">{t.adminTitle}</h1>
        <LanguageToggle className="h-11" />
      </div>
      <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 font-medium">
          {t.adminTokenLabel}
          <input
            type="password"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            autoComplete="current-password"
            required
            className="h-12 rounded-xl bg-surface px-3 text-base font-normal ring-1 ring-line"
          />
        </label>
        {problem && <Notice message={problem} />}
        <button
          type="submit"
          disabled={isChecking || !token.trim()}
          className="flex h-12 items-center justify-center gap-2 rounded-xl bg-brand font-semibold text-white disabled:opacity-40"
        >
          {isChecking && <LoaderCircle aria-hidden className="size-5 animate-spin" />}
          {t.adminSignIn}
        </button>
      </form>
    </main>
  );
}
