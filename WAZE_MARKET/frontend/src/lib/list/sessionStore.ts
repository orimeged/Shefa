/**
 * Keeps a shopping trip alive across reloads. Copying a list means leaving for
 * WhatsApp, and phones often reload a page they put in the background.
 */

import type { ListItem } from "./shoppingItems";

/** A list is put together first, and only asks for a route when the shopper says so. */
export type ListPhase = "building" | "shopping";

export interface ShoppingSession {
  items: ListItem[];
  found: string[];
  positionNodeId: string | null;
  /** The kiosk list this session started from. Scanning a new one starts over. */
  seedKey: string;
  /** Anonymous, and new for every trip. Sessions saved before it existed lack one. */
  sessionId?: string;
  /** Sessions saved before phases lack one. */
  phase?: ListPhase;
}

const STORAGE_KEY = "shopping-session:v1";
/** Long enough for one trip, short enough that next week starts clean. */
const MAX_AGE_MS = 12 * 60 * 60 * 1000;

export function phaseOf(session: ShoppingSession | null): ListPhase {
  if (session?.phase) {
    return session.phase;
  }
  // Before phases, every list had a route, and a position or a tick shows it got one.
  return session && (session.positionNodeId || session.found.length > 0) ? "shopping" : "building";
}

export function loadSession(now = Date.now()): ShoppingSession | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      return null;
    }
    const { savedAt, session } = JSON.parse(stored) as {
      savedAt: number;
      session: ShoppingSession;
    };
    return now - savedAt > MAX_AGE_MS ? null : session;
  } catch {
    return null;
  }
}

export function saveSession(session: ShoppingSession, now = Date.now()): void {
  try {
    if (session.items.length === 0) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ savedAt: now, session }));
    }
  } catch {
    // Private browsing or a full disk: the trip still works until a reload.
  }
}
