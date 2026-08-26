"use client";

import { useCallback, useState } from "react";
import { safeGetJSON, safeSetJSON } from "./safe-storage";
import type { BuildMode, LoadoutPiece, Perk } from "./types";

/* Battle Royale: play until the pool runs dry.
 *
 * Every build you use is retired, so the next roll draws from what is left.
 * The eliminated set is the whole feature, and it feeds the same
 * `combinedExcluded` pipeline that manual exclusions and the theme filter go
 * through — the roll never learns that Battle Royale exists.
 *
 * The set spans BOTH roles deliberately: switching role mid-game must not
 * hand back perks you already spent. Anything reporting a count to the player
 * therefore has to filter it to the current role first, or it disagrees with
 * the role-filtered pool size sitting next to it.
 *
 * Session storage, not local: a run is one sitting.
 */

/** Unchanged from when this lived in RandomizerBoard — a new key here would
 *  orphan every run already saved in a visitor's session. */
const BR_STORAGE_KEY = "dbd-randomizer:battle-royale";

interface StoredState {
  active: boolean;
  used: string[];
}

function persist(state: StoredState) {
  safeSetJSON("session", BR_STORAGE_KEY, state);
}

export interface BattleRoyaleController {
  active: boolean;
  /** Perk slugs and `kind:slug` loadout keys already spent, across both
   *  roles. Empty when the mode is off. */
  used: Set<string>;
  toggle: () => void;
  /** Same game, fresh pool. */
  restart: () => void;
  /** Retires whatever is currently on the board. Called when a build is used
   *  — copied, or rolled past. No-op when nothing is showing. */
  eliminate: (build: { mode: BuildMode; perks: Perk[]; loadoutPieces: LoadoutPiece[] }) => void;
  /** Restores a run in progress, at mount. */
  hydrate: () => void;
}

export function useBattleRoyale(): BattleRoyaleController {
  const [active, setActive] = useState(false);
  const [used, setUsed] = useState<Set<string>>(new Set());

  const toggle = useCallback(() => {
    /* Strict Mode (dev, React 19) invokes a setState updater twice to catch
       impurity. The side effects below — the storage write and the other
       setter — used to live inside setActive's updater and so fired twice
       per toggle. Computing `next` from the already-in-scope value and
       calling every setter as a plain top-level statement keeps setActive a
       pure value-set. Do not fold this back into an updater. */
    const next = !active;
    const nextUsed = next ? new Set<string>() : used;
    setActive(next);
    setUsed(nextUsed);
    persist({ active: next, used: [...nextUsed] });
  }, [active, used]);

  const restart = useCallback(() => {
    setUsed(new Set());
    persist({ active: true, used: [] });
  }, []);

  const eliminate = useCallback(
    ({ mode, perks, loadoutPieces }: { mode: BuildMode; perks: Perk[]; loadoutPieces: LoadoutPiece[] }) => {
      // "all" mode retires both halves in one update rather than two
      // setState calls — one player action should be one write to storage.
      const hasPerks = mode !== "loadout" && perks.length > 0;
      const hasLoadout = mode !== "perks" && loadoutPieces.length > 0;
      if (!hasPerks && !hasLoadout) return;
      setUsed((prev) => {
        const next = new Set(prev);
        if (hasPerks) perks.forEach((p) => next.add(p.slug));
        if (hasLoadout) loadoutPieces.forEach((p) => next.add(`${p.kind}:${p.slug}`));
        persist({ active: true, used: [...next] });
        return next;
      });
    },
    [],
  );

  const hydrate = useCallback(() => {
    const stored = safeGetJSON<Partial<StoredState>>("session", BR_STORAGE_KEY, {});
    if (stored.active !== true) return;
    setActive(true);
    setUsed(new Set(Array.isArray(stored.used) ? stored.used.filter((s) => typeof s === "string") : []));
  }, []);

  return { active, used, toggle, restart, eliminate, hydrate };
}
