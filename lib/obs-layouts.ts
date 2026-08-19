"use client";

// Named bookmarks for an overlay layout.
//
// Everything the modal configures already lives in the link, which makes
// the link the source of truth and means nothing needs to be stored to
// make the overlay work. What it doesn't cover is having *two* looks — a
// compact one for gameplay, a roomy one for the waiting screen. Dragging
// eight icons is real effort, and until now the only way to keep a second
// arrangement was to paste the link somewhere and hope.
//
// So this stores the settings, not the link: a saved layout can be applied
// on top of whatever is on screen, and the link is regenerated from it as
// usual.
import { useCallback, useEffect, useState } from "react";
import { safeGetJSON, safeSetJSON } from "./safe-storage";
import type { ObsIconPosition } from "./use-obs-mode";

const STORAGE_KEY = "dbd-randomizer:obs-layouts";
export const MAX_LAYOUTS = 8;
export const MAX_LAYOUT_NAME = 24;

/** Exactly the values that make an overlay look the way it looks. Stored
 *  as a flat snapshot rather than a reference to the live options, so a
 *  saved layout can't drift when the modal's state shape changes. */
export interface ObsLayoutSnapshot {
  scale: number;
  nameScale: number;
  canvasWidth: number;
  canvasHeight: number;
  showNames: boolean;
  showCharacter: boolean;
  darkBg: boolean;
  characterScale: number;
  positions: ObsIconPosition[] | null;
  characterPosition: ObsIconPosition | null;
}

export interface SavedLayout {
  name: string;
  snapshot: ObsLayoutSnapshot;
}

export function useObsLayouts() {
  const [layouts, setLayouts] = useState<SavedLayout[]>([]);

  // Gathered into a named function, matching how the rest of the app
  // restores saved settings — it keeps react-hooks/set-state-in-effect off
  // a pattern where the cascade it guards against is the entire point, and
  // reads as one restore rather than a stray setState.
  useEffect(() => {
    function restoreSavedLayouts() {
      setLayouts(safeGetJSON<SavedLayout[]>("local", STORAGE_KEY, []));
    }
    restoreSavedLayouts();
  }, []);

  const persist = useCallback((next: SavedLayout[]) => {
    setLayouts(next);
    safeSetJSON("local", STORAGE_KEY, next);
  }, []);

  return {
    layouts,
    /** Saves under `name`, replacing any layout already using it — the
     *  same name meaning the same slot is what someone expects from
     *  "save", and it keeps the list from filling with near-duplicates. */
    save(name: string, snapshot: ObsLayoutSnapshot) {
      const trimmed = name.trim().slice(0, MAX_LAYOUT_NAME);
      if (!trimmed) return;
      const without = layouts.filter((l) => l.name !== trimmed);
      if (without.length >= MAX_LAYOUTS) return;
      persist([...without, { name: trimmed, snapshot }]);
    },
    remove(name: string) {
      persist(layouts.filter((l) => l.name !== name));
    },
    isFull: layouts.length >= MAX_LAYOUTS,
  };
}
