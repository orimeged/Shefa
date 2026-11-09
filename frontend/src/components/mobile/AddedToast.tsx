import type { AddNotice } from "../../hooks/useShoppingList";
import { usePlace } from "../../hooks/usePlace";
import { useLanguage } from "../../i18n/LanguageProvider";
import { Toast } from "./Toast";

interface AddedToastProps {
  notice: AddNotice;
  onDismiss: () => void;
  aboveAction: boolean;
}

/** Says where a new item is, so nobody has to look for it on the list while walking. */
export function AddedToast({ notice, onDismiss, aboveAction }: AddedToastProps) {
  const { t } = useLanguage();
  const where = usePlace();

  const { single } = notice;
  const message = !single
    ? t.addedMany(notice.count, notice.unmatched)
    : single.placement
      ? t.addedOne(
          single.text,
          where(single.placement.categoryId, single.placement.aisleNo, single.placement.side),
        )
      : t.addedUnknown(single.text);

  return <Toast message={message} onDismiss={onDismiss} aboveAction={aboveAction} />;
}
