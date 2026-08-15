// Cross-tab pipe between the main app and the OBS overlay tab (see
// use-obs-mode.ts / components/dbd/obs-overlay.tsx). BroadcastChannel is
// the live-update transport — same-origin, near-instant, no polling. A
// mirrored localStorage write exists purely so an overlay tab opened
// *after* the last generate still has something to render immediately on
// load, before any new BroadcastChannel message arrives; the `storage`
// event listener is a belt-and-suspenders fallback for the (now vanishingly
// rare) case BroadcastChannel itself isn't available.
import type { Lang } from "./i18n";
import type { PerkRole } from "./types";
import { safeGetJSON, safeSetJSON } from "./safe-storage";

const CHANNEL_NAME = "dbd-randomizer:obs-sync";
const STORAGE_KEY = "dbd-randomizer:obs-last-state";

export interface ObsPerk {
  slug: string;
  icon: string;
  name: { en: string; ru: string };
}

export interface ObsSyncPayload {
  role: PerkRole;
  perks: ObsPerk[];
  language: Lang;
  updatedAt: number;
}

let channel: BroadcastChannel | null | undefined;

function getChannel(): BroadcastChannel | null {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") return null;
  if (channel === undefined) {
    try {
      channel = new BroadcastChannel(CHANNEL_NAME);
    } catch {
      channel = null;
    }
  }
  return channel;
}

export function publishObsState(payload: Omit<ObsSyncPayload, "updatedAt">): void {
  const full: ObsSyncPayload = { ...payload, updatedAt: Date.now() };
  safeSetJSON("local", STORAGE_KEY, full);
  getChannel()?.postMessage(full);
}

export function loadLastObsState(): ObsSyncPayload | null {
  return safeGetJSON<ObsSyncPayload | null>("local", STORAGE_KEY, null);
}

export function subscribeObsState(callback: (payload: ObsSyncPayload) => void): () => void {
  if (typeof window === "undefined") return () => {};

  const ch = getChannel();
  function handleMessage(e: MessageEvent<ObsSyncPayload>) {
    callback(e.data);
  }
  ch?.addEventListener("message", handleMessage);

  function handleStorage(e: StorageEvent) {
    if (e.key !== STORAGE_KEY || !e.newValue) return;
    try {
      callback(JSON.parse(e.newValue) as ObsSyncPayload);
    } catch {
      // Ignore a malformed write — the overlay just keeps showing whatever
      // it last had rather than crashing on someone else's bad data.
    }
  }
  window.addEventListener("storage", handleStorage);

  return () => {
    ch?.removeEventListener("message", handleMessage);
    window.removeEventListener("storage", handleStorage);
  };
}
