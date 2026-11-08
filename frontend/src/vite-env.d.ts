/// <reference types="vite/client" />

declare const __LAN_IP__: string | null;

interface ImportMetaEnv {
  readonly VITE_PUBLIC_ORIGIN?: string;
  /** The API's own address, when it isn't proxied through this site. */
  readonly VITE_BACKEND_URL?: string;
}
