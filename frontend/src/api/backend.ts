/**
 * Where the backend is. Unset, the default, means the page's own origin: the dev
 * and preview servers proxy /api and /ws to the backend, and so can a host's
 * rewrites. Set VITE_BACKEND_URL when the API lives on a domain of its own, such
 * as https://shefa-api.onrender.com; that backend must list this site in CORS_ORIGINS.
 */
const BACKEND_URL = normalize(import.meta.env.VITE_BACKEND_URL);

function normalize(url: string | undefined): string {
  return (url ?? "").trim().replace(/\/+$/, "");
}

export function apiUrl(path: string, backend: string = BACKEND_URL): string {
  return `${normalize(backend)}${path}`;
}

/** WebSockets need ws: or wss:, which a browser won't infer from a relative path. */
export function socketUrl(
  path: string,
  location: Pick<Location, "protocol" | "host">,
  backend: string = BACKEND_URL,
): string {
  const base = normalize(backend);
  if (base) {
    return `${base.replace(/^http(s?):/, "ws$1:")}${path}`;
  }
  return `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}${path}`;
}
