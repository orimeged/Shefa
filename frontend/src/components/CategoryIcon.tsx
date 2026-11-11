import type { LucideIcon, LucideProps } from "lucide-react";
import type { ReactNode } from "react";
import { createContext, use, useCallback, useMemo } from "react";

import type { Category } from "../api/types";
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

/** Whether a category has an icon of its own rather than the basket every other gets. */
export function hasCategoryIcon(categoryId: string): boolean {
  return categoryId in ICONS;
}

/** A placed product's department, by the product's route id: the icon it wears. */
const DepartmentOf = createContext<ReadonlyMap<string, string> | null>(null);

/** Lets every icon below show a placed product as its department, an apple as produce. */
export function ProductDepartmentsProvider({
  productStops,
  children,
}: {
  productStops: readonly Category[] | undefined;
  children: ReactNode;
}) {
  const departments = useMemo(
    () =>
      new Map(
        (productStops ?? []).flatMap((stop) => (stop.department_id ? [[stop.id, stop.department_id] as const] : [])),
      ),
    [productStops],
  );
  return <DepartmentOf value={departments}>{children}</DepartmentOf>;
}

/** The id whose icon a route target wears: a placed product's department, or itself. */
export function useIconId(): (categoryId: string) => string {
  const departments = use(DepartmentOf);
  return useCallback((categoryId: string) => departments?.get(categoryId) ?? categoryId, [departments]);
}

export function CategoryIcon({ categoryId, ...props }: LucideProps & { categoryId: string }) {
  const iconId = useIconId();
  const Icon = ICONS[iconId(categoryId)] ?? ShoppingBasket;
  return <Icon aria-hidden {...props} />;
}
