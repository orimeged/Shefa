import { CircleAlert } from "lucide-react";

import { useLanguage } from "../i18n/LanguageProvider";

interface NoticeProps {
  message: string;
  onRetry?: () => void;
  className?: string;
}

export function Notice({ message, onRetry, className = "" }: NoticeProps) {
  const { t } = useLanguage();

  return (
    <div
      role="alert"
      className={`flex items-center gap-3 rounded-2xl bg-danger-soft px-4 py-3 text-danger ${className}`}
    >
      <CircleAlert aria-hidden className="size-5 shrink-0" />
      <p className="min-w-0 flex-1 font-medium">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="-my-2 h-11 shrink-0 px-1 font-semibold underline"
        >
          {t.retry}
        </button>
      )}
    </div>
  );
}
