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

interface Departments {
  /** A placed product's department, by the product's route id: the icon it wears. */
  of: ReadonlyMap<string, string>;
  /** Each department by its id, for its name. */
  byId: ReadonlyMap<string, Category>;
}

const DepartmentsContext = createContext<Departments | null>(null);

/** Lets everything below show a placed product as its department, an apple as produce, and name departments. */
export function ProductDepartmentsProvider({
  productStops,
  departments,
  children,
}: {
  productStops: readonly Category[] | undefined;
  departments?: readonly Category[] | undefined;
  children: ReactNode;
}) {
  const value = useMemo(
    () => ({
      of: new Map(
        (productStops ?? []).flatMap((stop) => (stop.department_id ? [[stop.id, stop.department_id] as const] : [])),
      ),
      byId: new Map((departments ?? []).map((department) => [department.id, department] as const)),
    }),
    [productStops, departments],
  );
  return <DepartmentsContext value={value}>{children}</DepartmentsContext>;
}

/** The id whose icon a route target wears: a placed product's department, or itself. */
export function useIconId(): (categoryId: string) => string {
  const departments = use(DepartmentsContext);
  return useCallback((categoryId: string) => departments?.of.get(categoryId) ?? categoryId, [departments]);
}

/** A department by its id, for its name; undefined when the map isn't loaded or it's no department. */
export function useDepartment(): (departmentId: string) => Category | undefined {
  const departments = use(DepartmentsContext);
  return useCallback((departmentId: string) => departments?.byId.get(departmentId), [departments]);
}

export function CategoryIcon({ categoryId, ...props }: LucideProps & { categoryId: string }) {
  const iconId = useIconId();
  const Icon = ICONS[iconId(categoryId)] ?? ShoppingBasket;
  return <Icon aria-hidden {...props} />;
}
