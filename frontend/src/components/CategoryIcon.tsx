import type { LucideIcon, LucideProps } from "lucide-react";
import {
  Baby,
  Bath,
  Carrot,
  Coffee,
  Cookie,
  Croissant,
  CupSoda,
  Cylinder,
  Droplets,
  Drumstick,
  Milk,
  ShoppingBasket,
  Snowflake,
  Soup,
  SprayCan,
  Wheat,
} from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  produce: Carrot,
  bakery: Croissant,
  cereals: Wheat,
  sauces: Droplets,
  pasta: Soup,
  canned: Cylinder,
  snacks: Cookie,
  beverages: CupSoda,
  coffee: Coffee,
  cleaning: SprayCan,
  toiletries: Bath,
  baby: Baby,
  frozen: Snowflake,
  dairy: Milk,
  meat: Drumstick,
};

export function CategoryIcon({ categoryId, ...props }: LucideProps & { categoryId: string }) {
  const Icon = ICONS[categoryId] ?? ShoppingBasket;
  return <Icon aria-hidden {...props} />;
}
