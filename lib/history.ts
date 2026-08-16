import type { LoadoutKind, PerkRole } from "./types";
import { safeGetJSON, safeRemove, safeSetJSON } from "./safe-storage";

const STORAGE_KEY = "dbd-randomizer:history";
const MAX_ENTRIES = 20;

export type HistoryMode = "perks" | "loadout";

export interface HistoryEntry {
  id: string;
  mode: HistoryMode;
  role: PerkRole;
  /** Unix ms — Date.now() at record time. */
  at: number;
  /** Perks mode: plain perk slugs. Loadout mode: "kind:slug" keys, same
   *  namespacing as lib/loadout.ts's excludeKey — lets a single history
   *  entry resolve back to the exact Item/Addon/Offering objects via
   *  getLoadoutPiece(kind, slug) regardless of which kind they were. */
  keys: string[];
}

function loadHistory(): HistoryEntry[] {
  const stored = safeGetJSON<unknown>("local", STORAGE_KEY, []);
  return Array.isArray(stored) ? (stored as HistoryEntry[]) : [];
}

function saveHistory(entries: HistoryEntry[]): void {
  safeSetJSON("local", STORAGE_KEY, entries);
}

function sameKeys(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const setA = new Set(a);
  return b.every((k) => setA.has(k));
}

/** Records one roll into the history list, newest first, capped at
 *  MAX_ENTRIES (oldest silently drops off). Skips writing a duplicate of
 *  the current most-recent entry — same mode/role/keys — so re-viewing a
 *  shared/history build (which re-fires the same recording effect this
 *  feeds from) doesn't spam a second identical row right next to the
 *  first. */
export function recordHistoryEntry(entry: Omit<HistoryEntry, "id" | "at">): void {
  const history = loadHistory();
  const last = history[0];
  if (last && last.mode === entry.mode && last.role === entry.role && sameKeys(last.keys, entry.keys)) {
    return;
  }
  const full: HistoryEntry = {
    ...entry,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: Date.now(),
  };
  saveHistory([full, ...history].slice(0, MAX_ENTRIES));
}

export function getHistory(): HistoryEntry[] {
  return loadHistory();
}

export function clearHistory(): void {
  safeRemove("local", STORAGE_KEY);
}

/** Splits a loadout history entry's "kind:slug" keys back into typed
 *  lookup args — mirrors lib/loadout-ids.ts's getLoadoutPieceKeyForId,
 *  just starting from the raw key instead of a numeric ID. */
export function parseLoadoutKey(key: string): { kind: LoadoutKind; slug: string } | null {
  const separatorIndex = key.indexOf(":");
  if (separatorIndex === -1) return null;
  return {
    kind: key.slice(0, separatorIndex) as LoadoutKind,
    slug: key.slice(separatorIndex + 1),
  };
}
