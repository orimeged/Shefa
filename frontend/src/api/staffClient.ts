/** The floor staff's API. Every call carries the staff token (the dashboard's works too). */

import { apiUrl } from "./backend";
import { ApiError, STORE_ID } from "./client";
import type {
  CatalogCategory,
  CatalogProduct,
  GridRoute,
  NotFoundReport,
  NotFoundReportRow,
  PickSession,
  ResolvedItem,
  Resolution,
} from "./types";

const ROOT = apiUrl("/api/v1/staff");
const STORE_QUERY = new URLSearchParams({ store_id: STORE_ID }).toString();
const JSON_HEADERS = { "Content-Type": "application/json" };

/** Throws an ApiError for a wrong token (401) or a locked app (503). */
export async function checkStaffToken(token: string): Promise<void> {
  const response = await fetch(`${ROOT}/session`, { headers: { Authorization: `Bearer ${token}` } });
  // Exactly 204: a static host answers any path with its index page and a 200.
  if (response.status !== 204) {
    throw new ApiError(response.status, "Sign-in failed");
  }
}

export function createStaffApi(token: string, onUnauthorized: () => void) {
  async function send(url: string, init: RequestInit = {}): Promise<Response> {
    const response = await fetch(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}` } });
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

  const post = (url: string, body: unknown) => send(url, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(body) });

  return {
    /** Same names as the dashboard's, so both can drive the alerts hook. */
    notFoundReport: (signal?: AbortSignal) => json<NotFoundReportRow[]>(`${ROOT}/alerts?${STORE_QUERY}`, { signal }),

    resolveNotFound: async ({ item_query, category_id }: NotFoundReportRow, resolution: Resolution = "restocked") =>
      (await post(`${ROOT}/alerts/resolve`, { store_id: STORE_ID, item_query, category_id, resolution })).json() as Promise<{
        resolved: number;
      }>,

    /** Null when the server can't push: alerts then only arrive while the app is open. */
    pushKey: async () => (await json<{ public_key: string | null }>(`${ROOT}/push/key`)).public_key,

    subscribe: async (subscription: PushSubscriptionJSON) => {
      await post(`${ROOT}/push/subscriptions`, { store_id: STORE_ID, ...subscription });
    },

    unsubscribe: async (endpoint: string) => {
      await post(`${ROOT}/push/unsubscribe`, { endpoint });
    },

    testPush: async () => (await (await post(`${ROOT}/push/test`, { store_id: STORE_ID })).json()) as { sent: number },

    categories: (signal?: AbortSignal) => json<CatalogCategory[]>(`${ROOT}/categories?${STORE_QUERY}`, { signal }),

    /** One product or none: an unknown barcode is an empty list, not an error. */
    findProduct: (barcode: string) =>
      json<CatalogProduct[]>(`${ROOT}/products?${new URLSearchParams({ store_id: STORE_ID, barcode })}`),

    addProduct: async (draft: { name: string; barcode: string; department: string; subcategory: string | null }) =>
      (await post(`${ROOT}/products?${STORE_QUERY}`, draft)).json() as Promise<CatalogProduct>,

    /** An order's lines matched to the catalog, kept out of the shoppers' search figures. */
    resolveOrder: async (lines: readonly string[]) =>
      (await post(`${ROOT}/picks/resolve?${STORE_QUERY}`, { lines })).json() as Promise<ResolvedItem[]>,

    /** The order's shelves in walking order, not counted as a shopper's trip. */
    pickRoute: async (categoryIds: readonly string[]) =>
      (await post(`${ROOT}/picks/route?${STORE_QUERY}`, { category_ids: categoryIds })).json() as Promise<GridRoute>,

    /** A line not on its shelf: a report marked as a picker's, which always alerts. */
    pickMissing: async (report: NotFoundReport) => {
      await post(`${ROOT}/picks/missing`, report);
    },

    finishPick: async (session: PickSession) =>
      (await post(`${ROOT}/picks/finish`, session)).json() as Promise<{ recorded: boolean; minutes: number }>,

    /** Where it was found standing; nothing else about the product changes. */
    placeProduct: async (productId: number, placement: { department: string; subcategory: string | null }) =>
      (
        await send(`${ROOT}/products/${productId}?${STORE_QUERY}`, {
          method: "PATCH",
          headers: JSON_HEADERS,
          body: JSON.stringify(placement),
        })
      ).json() as Promise<CatalogProduct>,
  };
}

export type StaffApi = ReturnType<typeof createStaffApi>;
