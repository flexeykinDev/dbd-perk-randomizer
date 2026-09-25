"use client";

import { useCallback, useState } from "react";
import { rollSeededSquad, rollSquad, type Squad } from "./squad-roll";
import { safeGetJSON, safeSetJSON } from "./safe-storage";
import type { Perk, PerkRole } from "./types";

/* Squad mode: one build per member of a SWF team, no perk shared.
 *
 * The roll itself is lib/squad-roll.ts and knows nothing about React. This
 * holds the three things that outlive a single roll — whether the mode is on,
 * how many players, and the squad currently on screen — and the one decision
 * that needs both: a seeded squad when a seed is active, a random one
 * otherwise, which is the same fork useRollSession already makes for the
 * single build.
 *
 * The rolled squad is deliberately not persisted. Neither is the single
 * build: what comes back on a reload is the settings, not the last roll.
 */

const STORAGE_KEY = "dbd-randomizer:squad";

/** Four is a full SWF lobby and the only number most people will ever want;
 *  two and three exist because a duo or a trio is just as common a way to
 *  queue, and a lobby of one is the normal board. */
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 4;
export const DEFAULT_PLAYERS = 4;

interface StoredState {
  active: boolean;
  players: number;
}

function clampPlayers(value: unknown): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : DEFAULT_PLAYERS;
  return Math.min(MAX_PLAYERS, Math.max(MIN_PLAYERS, n));
}

/** SSR-safe defaults. Never read storage from here — see the note on
 *  `hydrate` below. */
const DEFAULT_STATE: StoredState = { active: false, players: DEFAULT_PLAYERS };

function load(): StoredState {
  // Read defensively: this shape could have been written by an older or a
  // newer version of the app, same as every other persisted setting here.
  const raw = safeGetJSON<Partial<StoredState> | null>("local", STORAGE_KEY, null);
  return {
    active: raw?.active === true,
    players: clampPlayers(raw?.players),
  };
}

export interface SquadRollInput {
  role: PerkRole;
  /** The pool the caller has already narrowed — exclusions, Battle Royale and
   *  role filtering are its business, exactly as for the single-build roll. */
  pool: readonly Perk[];
  buildSize: number;
  /** Present when a seed is driving the board, so the squad reproduces for
   *  everyone who opens the same seed. */
  seed?: string | null;
}

export interface SquadController {
  active: boolean;
  toggle: () => void;
  players: number;
  setPlayers: (next: number) => void;
  /** One build per player, or [] before the first roll. */
  squad: Squad;
  roll: (input: SquadRollInput) => void;
  /** Throw away the squad on screen without turning the mode off — for a
   *  caller about to show something else, e.g. a shared single build. */
  clear: () => void;
  /** Show a squad handed over whole, from a share link. Turns the mode on and
   *  sizes the lobby to what arrived, because a link for three players that
   *  opened four columns would be showing a squad nobody shared. */
  show: (builds: Squad) => void;
  /** Restores the saved settings, at mount. */
  hydrate: () => void;
}

export function useSquad(): SquadController {
  /* SSR-safe defaults, corrected from localStorage by `hydrate` in the
     board's mount effect — the same rule every other persisted setting here
     follows, and not a stylistic one. A lazy useState(load) initialiser reads
     storage during the client's FIRST render, which happens before hydration
     reconciles against the server's window-less HTML: React then finds the
     squad's four sections where the server sent a single loading grid and
     throws a hydration mismatch for every returning visitor who left the mode
     on. Found by reading the dev console with the mode enabled; the built
     export only regenerates the tree silently, so no test caught it. */
  const [state, setState] = useState<StoredState>(DEFAULT_STATE);
  const [squad, setSquad] = useState<Squad>([]);

  const persist = useCallback((next: StoredState) => {
    setState(next);
    safeSetJSON("local", STORAGE_KEY, next);
  }, []);

  const toggle = useCallback(() => {
    setState((prev) => {
      const next = { ...prev, active: !prev.active };
      safeSetJSON("local", STORAGE_KEY, next);
      return next;
    });
    // Leaving the mode drops the squad, so coming back does not show a stale
    // one from before whatever the player changed in between.
    setSquad([]);
  }, []);

  const setPlayers = useCallback(
    (next: number) => {
      persist({ active: true, players: clampPlayers(next) });
      // The old squad had a different number of hands in it; keeping it while
      // the control says otherwise is worse than showing nothing until the
      // next roll.
      setSquad([]);
    },
    [persist],
  );

  // Reads players from state rather than from inside a setState updater.
  // StrictMode double-invokes updaters to catch impurity, and rolling inside
  // one would draw twice per click — harmless-looking, but it means the dice
  // are thrown a different number of times in development and production.
  const roll = useCallback(
    ({ role, pool, buildSize, seed }: SquadRollInput) => {
      setSquad(
        seed
          ? rollSeededSquad(role, pool, buildSize, state.players, seed)
          : rollSquad(pool, buildSize, state.players),
      );
    },
    [state.players],
  );

  const clear = useCallback(() => setSquad([]), []);

  const hydrate = useCallback(() => {
    const stored = load();
    // Only when something was actually saved: setting the defaults again on
    // every mount would be a pointless render, and worse, it would stomp a
    // squad a share link had already installed if the order ever changed.
    if (!stored.active) return;
    setState(stored);
  }, []);

  const show = useCallback(
    (builds: Squad) => {
      if (builds.length === 0) return;
      persist({ active: true, players: clampPlayers(builds.length) });
      setSquad(builds);
    },
    [persist],
  );

  return {
    active: state.active,
    toggle,
    players: state.players,
    setPlayers,
    squad,
    roll,
    clear,
    show,
    hydrate,
  };
}
