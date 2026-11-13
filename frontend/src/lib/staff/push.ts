/**
 * Alerts pushed to a staff phone with the app closed (Web Push).
 *
 * Android's browsers can subscribe from the page. An iPhone can only once the app
 * is on its home screen and opened from there (iOS 16.4 and later), so on an
 * iPhone in Safari the first step is to install it.
 */

export type PushState =
  | "checking"
  /** This browser can't receive pushes at all. */
  | "unsupported"
  /** An iPhone in Safari: add to the home screen, open from there, then turn alerts on. */
  | "install-first"
  /** The server has no VAPID key: alerts only show while the app is open. */
  | "server-off"
  /** Notifications were refused for this site; only the phone's settings can undo it. */
  | "denied"
  | "off"
  | "on";

export interface PushFacts {
  supported: boolean;
  ios: boolean;
  installed: boolean;
  serverKey: string | null;
  permission: NotificationPermission | null;
  subscribed: boolean;
}

/** What the alerts switch should say, from what this phone and the server can do. */
export function pushStateOf(facts: PushFacts): PushState {
  if (!facts.supported) {
    return facts.ios && !facts.installed ? "install-first" : "unsupported";
  }
  if (!facts.serverKey) return "server-off";
  if (facts.permission === "denied") return "denied";
  return facts.subscribed && facts.permission === "granted" ? "on" : "off";
}

export function pushSupported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export function isIos(): boolean {
  // iPadOS reports itself as a Mac, but a Mac has no touch screen.
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

export function isInstalled(): boolean {
  return matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
}

/** The server's public key as the push manager wants it: base64url to bytes. */
export function applicationServerKey(base64url: string): Uint8Array<ArrayBuffer> {
  const padded = base64url.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(base64url.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/** Only the staff pages: the shoppers' pages never get a service worker. */
export function staffRegistration(): Promise<ServiceWorkerRegistration> {
  return navigator.serviceWorker.register("/sw.js", { scope: "/staff" });
}
