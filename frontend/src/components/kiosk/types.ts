import type { Side } from "../../api/types";

export interface CartItem {
  categoryId: string;
  name: string;
  nameEn: string;
  aisleNo: number;
  side: Side;
  /** Which badge colour the item wears for as long as it's on the list. */
  tone: number;
}

/** An item as it's picked, before the list gives it a colour. */
export type NewCartItem = Omit<CartItem, "tone">;
