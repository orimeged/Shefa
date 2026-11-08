/** The store managers' API. Every call carries the token from the sign-in screen. */

import { apiUrl } from "./backend";
import { ApiError, STORE_ID } from "./client";
import type {
  CatalogCategory,
  CatalogEntry,
  DashboardCounts,
  EntityType,
  HeatmapReport,
  LostDemandReport,
  MapAudioResult,
  NotFoundReportRow,
  SavedFloorPlan,
  StagedItem,
  TrafficReport,
  Zone,
  ZoneItem,
} from "./types";

const ROOT = apiUrl("/api/v1/admin");
const STORE = `${ROOT}/stores/${STORE_ID}`;
const ANALYTICS = `${ROOT}/analytics`;
const FLOOR_PLAN = apiUrl(`/api/v1/stores/${STORE_ID}/floor-plan`);
const STORE_QUERY = new URLSearchParams({ store_id: STORE_ID }).toString();
const JSON_HEADERS = { "Content-Type": "application/json" };

/** Throws an ApiError for a wrong token (401) or a locked dashboard (503). */
export async function checkAdminToken(token: string): Promise<void> {
  const response = await fetch(`${ROOT}/session`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  // Exactly 204: a static host answers any path with its index page and a 200.
  if (response.status !== 204) {
    throw new ApiError(response.status, "Sign-in failed");
  }
}

export function createAdminApi(token: string, onUnauthorized: () => void) {
  async function send(url: string, init: RequestInit = {}): Promise<Response> {
    const response = await fetch(url, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${token}` },
    });
    if (response.status === 401) {
      onUnauthorized();
    }
    if (!response.ok) {
      throw new ApiError(response.status, `${init.method ?? "GET"} ${url} failed`);
    }
    return response;
  }

  async function json<T>(url: string, init?: RequestInit): Promise<T> {
    return (await send(url, init)).json() as Promise<T>;
  }

  const assignments = (nodeId: number) => `${STORE}/nodes/${nodeId}/assignments`;

  return {
    zones: (signal?: AbortSignal) => json<Zone[]>(`${STORE}/nodes`, { signal }),

    categories: (signal?: AbortSignal) =>
      json<CatalogCategory[]>(`${STORE}/categories`, { signal }),

    searchCatalog: (query: string, signal?: AbortSignal) =>
      json<CatalogEntry[]>(`${STORE}/catalog?${new URLSearchParams({ q: query })}`, { signal }),

    zoneItems: (nodeId: number, signal?: AbortSignal) =>
      json<ZoneItem[]>(assignments(nodeId), { signal }),

    /** With `relocate`, a product leaves every other zone instead of standing in one more. */
    assign: (nodeId: number, entityType: EntityType, entityId: number, relocate = false) =>
      json<ZoneItem[]>(assignments(nodeId), {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ entity_type: entityType, entity_id: entityId, relocate }),
      }),

    assignBatch: (nodeId: number, items: readonly StagedItem[], relocate = false) =>
      json<ZoneItem[]>(`${assignments(nodeId)}/batch`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ items, relocate }),
      }),

    move: (nodeId: number, entityType: EntityType, entityId: number, toNodeId: number) =>
      json<ZoneItem[]>(`${assignments(nodeId)}/${entityType}/${entityId}`, {
        method: "PATCH",
        headers: JSON_HEADERS,
        body: JSON.stringify({ to_node_id: toNodeId }),
      }),

    remove: async (nodeId: number, entityType: EntityType, entityId: number) => {
      await send(`${assignments(nodeId)}/${entityType}/${entityId}`, { method: "DELETE" });
    },

    notFoundReport: (signal?: AbortSignal) =>
      json<NotFoundReportRow[]>(
        `${ROOT}/reports/not-found?${new URLSearchParams({ store_id: STORE_ID })}`,
        { signal },
      ),

    resolveNotFound: ({ item_query, category_id }: NotFoundReportRow) =>
      json<{ resolved: number }>(`${ROOT}/reports/not-found/resolve`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ store_id: STORE_ID, item_query, category_id }),
      }),

    dashboardCounts: (signal?: AbortSignal) =>
      json<DashboardCounts>(`${ANALYTICS}/summary?${STORE_QUERY}`, { signal }),

    lostDemand: (signal?: AbortSignal) =>
      json<LostDemandReport>(`${ANALYTICS}/lost-demand?${STORE_QUERY}`, { signal }),

    notFoundHeatmap: (signal?: AbortSignal) =>
      json<HeatmapReport>(`${ANALYTICS}/not-found-heatmap?${STORE_QUERY}`, { signal }),

    trafficFlow: (signal?: AbortSignal) =>
      json<TrafficReport>(`${ANALYTICS}/traffic-flow?${STORE_QUERY}`, { signal }),

    /** Null until a manager saves the store's first floor plan: the server answers 204. */
    floorPlan: async (signal?: AbortSignal): Promise<SavedFloorPlan | null> => {
      const response = await send(FLOOR_PLAN, { signal });
      return response.status === 204 ? null : ((await response.json()) as SavedFloorPlan);
    },

    saveFloorPlan: (payloadJson: string) =>
      json<SavedFloorPlan>(FLOOR_PLAN, { method: "PUT", headers: JSON_HEADERS, body: payloadJson }),

    mapAudio: (clip: Blob, language: string) =>
      json<MapAudioResult>(
        `${ROOT}/map-audio?${new URLSearchParams({ store_id: STORE_ID, language })}`,
        { method: "POST", headers: { "Content-Type": clip.type }, body: clip },
      ),
  };
}

export type AdminApi = ReturnType<typeof createAdminApi>;
