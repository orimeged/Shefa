import { apiUrl } from "./backend";
import type {
  FloorRouteRequest,
  GridPoint,
  GridRoute,
  NotFoundReport,
  ResolvedItem,
  Route,
  RouteRequest,
  SavedFloorPlan,
  SearchHit,
  StoreMap,
} from "./types";

export const STORE_ID = "demo";
// Relative unless VITE_BACKEND_URL says otherwise: the dev and preview servers
// proxy it to the backend, so phones on the network work the same as the kiosk.
const BASE_URL = apiUrl(`/api/v1/stores/${STORE_ID}`);

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function send(url: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new ApiError(response.status, `${init?.method ?? "GET"} ${url} failed`);
  }
  return response;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await send(`${BASE_URL}${path}`, init);
  return response.json() as Promise<T>;
}

export function getStoreMap(signal?: AbortSignal): Promise<StoreMap> {
  return request("/map", { signal });
}

export function searchCategories(query: string, signal?: AbortSignal): Promise<SearchHit[]> {
  return request(`/search?${new URLSearchParams({ q: query })}`, { signal });
}

/** The lines a photo of a shopping list reads as. */
export async function readListPhoto(photo: Blob, signal?: AbortSignal): Promise<string[]> {
  const response = await send(apiUrl("/api/v1/list/photo"), {
    method: "POST",
    headers: { "Content-Type": photo.type },
    body: photo,
    signal,
  });
  const { items } = (await response.json()) as { items: string[] };
  return items;
}

/** Matches a whole list in one request, which matters on a store's weak signal. */
export function resolveList(
  lines: readonly string[],
  sessionId: string,
): Promise<ResolvedItem[]> {
  return request("/list/resolve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lines, session_id: sessionId }),
  });
}

/** The plan managers drew, or null when none is saved yet (the server answers 204). */
export async function getFloorPlan(signal?: AbortSignal): Promise<SavedFloorPlan | null> {
  const response = await send(`${BASE_URL}/floor-plan`, { signal });
  return response.status === 204 ? null : ((await response.json()) as SavedFloorPlan);
}

/** Where a shopper stands for a drawn shelf: what an aisle-end sign means by "you are here". */
export function getShelfSpot(shelf: string, signal?: AbortSignal): Promise<GridPoint> {
  return request(`/floor-plan/spot?${new URLSearchParams({ shelf })}`, { signal });
}

export function createFloorRoute(body: FloorRouteRequest, signal?: AbortSignal): Promise<GridRoute> {
  return request("/floor-plan/routes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
}

export function createRoute(body: RouteRequest, signal?: AbortSignal): Promise<Route> {
  return request("/routes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
}

/** `keepalive` lets a report finish even if the shopper closes the page right after. */
export async function postNotFoundReport(report: NotFoundReport): Promise<void> {
  await send(apiUrl("/api/events/not-found"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(report),
    keepalive: true,
  });
}
