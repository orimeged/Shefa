// The dashboard's cards, in the staff app's look: white on the warm paper, round, one thin line.
export const CARD = "flex flex-col rounded-3xl bg-surface p-5 shadow-sm ring-1 ring-line";
export const CARD_TITLE = "text-lg font-semibold text-ink";
/** The main action of a card. */
export const PRIMARY_BUTTON =
  "flex h-12 items-center justify-center gap-2 rounded-2xl bg-brand px-5 font-semibold text-white shadow-sm disabled:opacity-50";
/** Any other action beside it. */
export const SECONDARY_BUTTON =
  "flex h-12 items-center justify-center gap-2 rounded-2xl bg-surface px-4 font-medium text-ink ring-1 ring-line hover:bg-paper disabled:opacity-60";
/** A text field or a select. */
export const FIELD =
  "h-12 w-full rounded-2xl bg-surface px-3 text-ink ring-1 ring-line outline-none focus:ring-2 focus:ring-brand";
