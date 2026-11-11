/** Mirrors backend/app/domain/models.py. */

export type NodeType = "entrance" | "checkout" | "junction" | "section";
export type Side = "left" | "right";

export interface StoreNode {
  id: string;
  x: number;
  y: number;
  type: NodeType;
}

export interface StoreEdge {
  from_node: string;
  to_node: string;
  length_m: number;
}

export interface Section {
  id: string;
  node_id: string;
  aisle_no: number;
  side: Side;
}

export interface Category {
  id: string;
  name: string;
  name_en: string;
  section_id: string;
  aliases: string[];
  /** A placed product: the department it belongs to, whose icon it shows. */
  department_id?: string | null;
  /** A placed product's subcategory, which a drawn plan may give a shelf of its own. */
  subcategory?: string | null;
}

export interface StoreMap {
  id: string;
  name: string;
  width_m: number;
  height_m: number;
  nodes: StoreNode[];
  edges: StoreEdge[];
  sections: Section[];
  categories: Category[];
  /** Products a manager placed themselves. Each one is a stop of its own. */
  product_stops: Category[];
}

export interface SearchHit {
  category_id: string;
  category_name: string;
  category_name_en: string;
  aisle_no: number;
  side: Side;
  matched_text: string;
  score: number;
}

/** One item from a list line. `hit` is null when the store has no match. */
export interface ResolvedItem {
  line: number;
  text: string;
  hit: SearchHit | null;
  source: "catalog" | "llm" | null;
  /** The dictionary term this matched, as "category:term", when there was one. */
  dictionary_id: string | null;
}

/** Mirrors NotFoundReport in backend/app/domain/events.py. */
export interface NotFoundReport {
  event_id: string;
  store_id: string;
  session_id: string;
  item_query: string;
  category_id: string | null;
  x_coord: number;
  y_coord: number;
  timestamp: string;
}

export interface RoutePoint {
  node_id: string;
  x: number;
  y: number;
}

export interface RouteLeg {
  to_node_id: string;
  length_m: number;
  points: RoutePoint[];
}

export interface RouteStop {
  seq: number;
  category_id: string;
  category_name: string;
  category_name_en: string;
  node_id: string;
  aisle_no: number;
  side: Side;
  x: number;
  y: number;
  leg_index: number;
  /** On a drawn floor plan: the department it stands in. There are no aisles there. */
  department?: string;
}

/** `legs[stop.leg_index]` ends at that stop, and the last leg ends at the checkout. */
export interface Route {
  store_id: string;
  start_node_id: string;
  end_node_id: string;
  total_length_m: number;
  stops: RouteStop[];
  legs: RouteLeg[];
  /** Asked for, but no longer anywhere in the store. */
  unplaced_category_ids: string[];
}

export interface RouteRequest {
  category_ids: string[];
  start_node_id?: string;
  /** One shopping trip, so a re-planned route isn't counted as another. */
  session_id?: string;
}

/** Mirrors backend/app/domain/inventory.py. */
export type EntityType = "product" | "category";

export interface Zone {
  id: number;
  zone_name: string;
  svg_element_id: string;
  section_id: string;
  x: number;
  y: number;
  item_count: number;
  /** The department standing here, to label the zone. */
  preview: string | null;
  preview_en: string | null;
}

export interface CatalogCategory {
  id: number;
  slug: string;
  name: string;
  name_en: string;
  /** Its products' subcategories, which a drawn plan can give shelves of their own. */
  subcategories?: string[];
}

export interface ZoneItem {
  entity_type: EntityType;
  entity_id: number;
  name: string;
  category_name: string;
  category_name_en: string;
  /** How many products a whole category covers. */
  product_count: number | null;
  subcategory: string | null;
  barcode: string | null;
}

export interface CatalogEntry {
  entity_type: EntityType;
  entity_id: number;
  name: string;
  category_name: string;
}

export interface StagedItem {
  name: string;
  category_id: number;
}

export interface DictatedItem {
  normalized_name: string;
  /** A category slug, or "none". */
  inferred_category: string;
}

export interface MapAudioResult {
  transcript: string;
  items: DictatedItem[];
  classified_by: "claude" | "dictionary";
}

export interface NotFoundReportRow {
  item_query: string;
  /** What the shopper was routed to: a category slug or a product stop. */
  category_id: string | null;
  /** Null when a report named no category, or one the store has since dropped. */
  catalog_category_id: number | null;
  category_name: string | null;
  category_name_en: string | null;
  times_reported: number;
  last_reported_at: string;
}

/** Mirrors backend/app/api/analytics.py. */
export interface CountPair {
  current: number;
  /** The same figure one week back. */
  previous: number;
}

export interface DashboardCounts {
  routes_today: CountPair;
  missing_alerts: CountPair;
  unfulfilled_searches: CountPair;
}

export interface LostItem {
  item: string;
  category_id: string | null;
  category_name: string | null;
  category_name_en: string | null;
  times: number;
}

export interface LostCategory {
  category_id: string | null;
  category_name: string | null;
  category_name_en: string | null;
  times: number;
  share: number;
}

export interface LostDemandReport {
  total: number;
  items: LostItem[];
  categories: LostCategory[];
}

export interface HeatPoint {
  x: number;
  y: number;
  count: number;
}

export interface HeatmapReport {
  total: number;
  points: HeatPoint[];
}

export interface EdgeFlow {
  from_node: string;
  to_node: string;
  trips: number;
}

export interface TrafficReport {
  trips: number;
  edges: EdgeFlow[];
  /** Steps between floor-plan tiles, as "cell:row:col", only those someone walked. */
  cell_edges?: EdgeFlow[];
}

export type FloorPlanProblem = "no_entrance" | "no_checkout" | "checkout_unreachable";

export interface FloorPlanDepartment {
  label: string;
  tiles: number;
  /** The catalog department its name matched; null if none did. */
  category_id: string | null;
  /** False when no open tile beside it can be reached from the entrance. */
  reachable: boolean;
}

/** What the server found in a saved floor plan, for the manager to fix. */
export interface FloorPlanCheck {
  routable: boolean;
  problems: FloorPlanProblem[];
  departments: FloorPlanDepartment[];
}

export interface SavedFloorPlan {
  store_id: string;
  /** The editor's own payload, checked by the server; read it with `fromPayload`. */
  floor_plan: unknown;
  updated_at: string;
  check: FloorPlanCheck;
  /** Category or placed product id to the drawn department a route goes to. Absent: not drawn. */
  placements: Record<string, string>;
}

/** Mirrors backend/app/domain/floor_routing.py. */
export interface GridPoint {
  row: number;
  col: number;
}

export interface GridRouteStop {
  seq: number;
  category_id: string;
  category_name: string;
  category_name_en: string;
  department: string;
  row: number;
  col: number;
  leg_index: number;
}

export interface GridRouteLeg {
  length_m: number;
  cells: GridPoint[];
}

export interface GridRoute {
  store_id: string;
  start: GridPoint;
  end: GridPoint;
  total_length_m: number;
  stops: GridRouteStop[];
  legs: GridRouteLeg[];
  unplaced_category_ids: string[];
}

export interface FloorRouteRequest {
  category_ids: string[];
  start?: GridPoint;
  session_id?: string;
}
