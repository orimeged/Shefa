import { resolvePublicOrigin } from "../../lib/shareUrl";

export function publicOrigin(): string {
  return resolvePublicOrigin({
    configuredOrigin: import.meta.env.VITE_PUBLIC_ORIGIN,
    lanIp: __LAN_IP__,
    location: window.location,
  });
}
