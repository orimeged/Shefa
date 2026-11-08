import type { Language } from "../i18n/strings";
import { DEFAULT_LANGUAGE } from "../i18n/strings";

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

interface OriginSources {
  configuredOrigin?: string;
  lanIp: string | null;
  location: Pick<Location, "protocol" | "hostname" | "port" | "origin">;
}

/** The origin to put in the QR code: one a phone on the network can open. */
export function resolvePublicOrigin({ configuredOrigin, lanIp, location }: OriginSources): string {
  if (configuredOrigin) {
    return configuredOrigin.replace(/\/+$/, "");
  }
  if (LOCAL_HOSTNAMES.has(location.hostname) && lanIp) {
    const port = location.port ? `:${location.port}` : "";
    return `${location.protocol}//${lanIp}${port}`;
  }
  return location.origin;
}

export function isReachableFromPhone(origin: string): boolean {
  return !LOCAL_HOSTNAMES.has(new URL(origin).hostname);
}

export function buildMobileUrl(
  origin: string,
  categoryIds: readonly string[],
  language: Language,
): string {
  const params = [];
  if (categoryIds.length > 0) {
    params.push(`categories=${categoryIds.map(encodeURIComponent).join(",")}`);
  }
  if (language !== DEFAULT_LANGUAGE) {
    params.push(`lang=${language}`);
  }
  return `${origin}/mobile${params.length > 0 ? `?${params.join("&")}` : ""}`;
}

export function parseCategoryIds(value: string | null): string[] {
  const ids = (value ?? "").split(",").map((id) => id.trim());
  return [...new Set(ids.filter(Boolean))];
}
