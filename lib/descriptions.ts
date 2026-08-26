"use client";

// On-demand loading for the description text that used to ship with every
// page load (see scripts/split-descriptions.ts for the measurements).
//
// Two separate bundles rather than one, because they're wanted at different
// times and by different people: someone who only ever uses Perks mode has
// no reason to download 162 KB of add-on prose, and vice versa.
//
// The load is kicked off on idle rather than waited for on click. By the
// time anyone has moved a mouse to a card the text is normally already
// here, so in practice the fallback below is a frame or two on a cold
// cache, not a spinner people watch.
import { useSyncExternalStore } from "react";
import type { LocalizedDescription } from "./types";

export interface DescriptionEntry {
  description: string;
  descriptionRu?: LocalizedDescription;
  descriptionRuRaw?: string;
}

type Lookup = Record<string, DescriptionEntry>;
type Which = "perks" | "loadout";

const loaded: Partial<Record<Which, Lookup>> = {};
const inflight: Partial<Record<Which, Promise<void>>> = {};
const listeners = new Set<() => void>();

/** Bumped whenever a bundle arrives, so useSyncExternalStore has a stable
 *  primitive to compare rather than a fresh object each render. */
let version = 0;

function emit() {
  version++;
  for (const listener of listeners) listener();
}

async function fetchBundle(which: Which): Promise<void> {
  // Static imports of these paths would defeat the entire point — the
  // bundler would fold them back into the main chunk. Dynamic import is
  // what makes them their own.
  const mod =
    which === "perks"
      ? await import("@/data/perk-descriptions.json")
      : await import("@/data/loadout-descriptions.json");
  loaded[which] = (mod.default ?? mod) as unknown as Lookup;
  emit();
}

/** Starts a load if one hasn't started already. Safe to call repeatedly —
 *  a second call while the first is in flight joins it rather than
 *  fetching twice. */
function loadDescriptions(which: Which): Promise<void> {
  if (loaded[which]) return Promise.resolve();
  inflight[which] ??= fetchBundle(which).catch(() => {
    // A failed load leaves the card showing its name and no prose, which
    // is the same thing an offline visitor sees. Clearing the in-flight
    // marker lets the next card open try again.
    delete inflight[which];
  });
  return inflight[which];
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const getVersion = () => version;
// The server render has no bundles and must not claim otherwise, or the
// first client render would disagree with the HTML it's hydrating.
const getServerVersion = () => 0;

/**
 * The description for one entry, or null until its bundle has arrived.
 *
 * Requesting one is what triggers the load, so a component can simply ask
 * for what it wants and re-render when it turns up.
 *
 * @param key Plain slug for a perk; `kind:slug` for a loadout piece, since
 *   an item, an add-on and an offering can share a slug.
 */
export function useDescription(which: Which, key: string): DescriptionEntry | null {
  useSyncExternalStore(subscribe, getVersion, getServerVersion);
  if (!loaded[which]) {
    // Kicking the load off during render is deliberate: this hook is only
    // called from a detail view that has just opened, and waiting for an
    // effect would add a frame of "no text" for no benefit. loadDescriptions
    // is idempotent, so a re-render can't stack requests.
    void loadDescriptions(which);
    return null;
  }
  return loaded[which][key] ?? null;
}

/** Warms both bundles once the page is otherwise idle, so the first card
 *  someone opens has its text already. Deliberately not awaited and
 *  deliberately not on the critical path. */
export function prefetchDescriptions(): void {
  if (typeof window === "undefined") return;
  const warm = () => {
    void loadDescriptions("perks");
    void loadDescriptions("loadout");
  };
  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(warm, { timeout: 4000 });
  } else {
    setTimeout(warm, 1500);
  }
}
