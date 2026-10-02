"use client";

// The five settings the board remembers between visits.
//
// How many perks, which mode, which loadout slots get rolled, whether a
// chosen character's own perks are guaranteed, and which kinds show on the
// overlay and in a downloaded image. They have nothing in common except that
// each one is a piece of state with a localStorage key behind it, which is
// exactly why they belong together: the board was carrying five defaults,
// five storage keys, four loader functions and five writers inline, and the
// pattern was repeated often enough that getting one of them wrong would have
// looked like all the others.
//
// Every one of them starts at an SSR-safe default and is corrected by
// `hydrate()` after mount. A lazy `useState(loadX)` initialiser would read
// localStorage during the client's first render, which happens *before*
// hydration reconciles against the server's window-less HTML, and React would
// flag a mismatch for any returning visitor who had ever changed a setting.
//
// What this hook does NOT decide is what a change costs. Picking a new mode
// drops the build and rolls again; changing the perk count only rerolls the
// perks; turning off a loadout slot only rerolls the loadout. That is the
// board's call, because only the board can see the roll session, so every
// setter here does its own job and returns.
import { useCallback, useState } from "react";
import { safeGet, safeGetJSON, safeSet, safeSetJSON } from "./safe-storage";
import type { BuildMode, LoadoutSlots, PieceVisibility } from "./types";

export const MAX_PERK_COUNT = 4;
const DEFAULT_PERK_COUNT = 4;

const PERK_COUNT_STORAGE_KEY = "dbd-randomizer:perk-count";
const MODE_STORAGE_KEY = "dbd-randomizer:mode";
const LOADOUT_SLOT_ITEM_STORAGE_KEY = "dbd-randomizer:loadout-slot-item";
const LOADOUT_SLOT_ADDONS_STORAGE_KEY = "dbd-randomizer:loadout-slot-addons";
const LOADOUT_SLOT_OFFERING_STORAGE_KEY =
  "dbd-randomizer:loadout-slot-offering";
const GUARANTEE_TEACHABLES_STORAGE_KEY = "dbd-randomizer:guarantee-teachables";
const PIECE_VISIBILITY_STORAGE_KEY = "dbd-randomizer:piece-visibility";

const DEFAULT_LOADOUT_SLOTS: LoadoutSlots = {
  item: true,
  addons: true,
  offering: true,
};
const DEFAULT_PIECE_VISIBILITY: PieceVisibility = {
  perks: true,
  item: true,
  addon: true,
  offering: true,
};

// "all" shows the perk grid and the loadout HUD together — a real player
// always has both equipped at once in an actual match, so this is what a
// visitor asking for "just show me everything" gets instead of having to
// flip between the other two.
const VALID_MODES: readonly BuildMode[] = ["perks", "loadout", "all"];

function loadPerkCount(): number {
  const n = parseInt(safeGet("local", PERK_COUNT_STORAGE_KEY) ?? "", 10);
  return Number.isInteger(n) && n >= 0 && n <= MAX_PERK_COUNT
    ? n
    : DEFAULT_PERK_COUNT;
}

function loadMode(): BuildMode {
  const stored = safeGet("local", MODE_STORAGE_KEY);
  return VALID_MODES.includes(stored as BuildMode)
    ? (stored as BuildMode)
    : "perks";
}

function loadLoadoutSlots(): LoadoutSlots {
  // Absent key (never saved yet) means "on" — DEFAULT_LOADOUT_SLOTS is
  // all-true, and only an explicit "0" write should turn a slot off.
  return {
    item: safeGet("local", LOADOUT_SLOT_ITEM_STORAGE_KEY) !== "0",
    addons: safeGet("local", LOADOUT_SLOT_ADDONS_STORAGE_KEY) !== "0",
    offering: safeGet("local", LOADOUT_SLOT_OFFERING_STORAGE_KEY) !== "0",
  };
}

const SLOT_STORAGE_KEY: Record<keyof LoadoutSlots, string> = {
  item: LOADOUT_SLOT_ITEM_STORAGE_KEY,
  addons: LOADOUT_SLOT_ADDONS_STORAGE_KEY,
  offering: LOADOUT_SLOT_OFFERING_STORAGE_KEY,
};

export interface BoardSettings {
  perkCount: number;
  mode: BuildMode;
  loadoutSlots: LoadoutSlots;
  guaranteeTeachables: boolean;
  /** Display-only, and deliberately separate from `loadoutSlots`, which
   *  decides what actually gets *rolled*: a streamer might want the full
   *  loadout rolled to reference themselves while only showing perks and the
   *  Item on stream. */
  pieceVisibility: PieceVisibility;

  /* Chosen, and therefore remembered. */
  setPerkCount: (next: number) => void;
  setMode: (next: BuildMode) => void;
  toggleLoadoutSlot: (slot: keyof LoadoutSlots) => void;
  toggleGuaranteeTeachables: () => void;
  setPieceVisibility: (kind: keyof PieceVisibility, value: boolean) => void;

  /* Imposed by a build that arrived whole — a share link, a saved build, a
     squad — rather than chosen. These do not write to storage: a four-perk
     link opened once should not quietly become your saved preference.
     (History's restore is the one caller that does persist the mode, by
     calling setMode instead. That predates this hook and is left as it was.) */
  showPerkCount: (next: number) => void;
  showMode: (next: BuildMode) => void;

  /** Reads all five from storage. Called once after mount — see the note at
   *  the top of the file for why this cannot be a lazy initialiser. */
  hydrate: () => void;

  /** Back to a first visit's settings, and saved as such.
   *
   *  Writes rather than clearing the keys: a visitor who resets and comes back
   *  should find the defaults, not whatever they had set two weeks ago. The
   *  board composes this with the other hooks' resets — see resetFilters
   *  there — because "reset" spans a dozen hooks and only the board sees them
   *  all. */
  reset: () => void;

  /** Whether all five are at their defaults, so the board can hide a reset
   *  that would do nothing. */
  isDefault: boolean;
}

export function useBoardSettings(): BoardSettings {
  const [perkCount, setPerkCountState] = useState<number>(DEFAULT_PERK_COUNT);
  const [mode, setModeState] = useState<BuildMode>("perks");
  const [loadoutSlots, setLoadoutSlots] = useState<LoadoutSlots>(
    DEFAULT_LOADOUT_SLOTS,
  );
  const [guaranteeTeachables, setGuaranteeTeachables] = useState(false);
  const [pieceVisibility, setPieceVisibilityState] = useState<PieceVisibility>(
    DEFAULT_PIECE_VISIBILITY,
  );

  const setPerkCount = useCallback((next: number) => {
    safeSet("local", PERK_COUNT_STORAGE_KEY, String(next));
    setPerkCountState(next);
  }, []);

  const setMode = useCallback((next: BuildMode) => {
    safeSet("local", MODE_STORAGE_KEY, next);
    setModeState(next);
  }, []);

  const toggleLoadoutSlot = useCallback((slot: keyof LoadoutSlots) => {
    setLoadoutSlots((prev) => {
      const next = { ...prev, [slot]: !prev[slot] };
      /* The write sits inside the updater, which StrictMode double-invokes —
         tolerable only because it is idempotent: both passes compute the same
         object and store the same string. use-setup-disclosure.ts keeps its
         write outside for the same reason stated in reverse. Left as the board
         had it rather than tidied, so this extraction changes nothing. */
      safeSet("local", SLOT_STORAGE_KEY[slot], next[slot] ? "1" : "0");
      return next;
    });
  }, []);

  const toggleGuaranteeTeachables = useCallback(() => {
    const next = !guaranteeTeachables;
    safeSet("local", GUARANTEE_TEACHABLES_STORAGE_KEY, next ? "1" : "0");
    setGuaranteeTeachables(next);
  }, [guaranteeTeachables]);

  const setPieceVisibility = useCallback(
    (kind: keyof PieceVisibility, value: boolean) => {
      setPieceVisibilityState((prev) => {
        const next = { ...prev, [kind]: value };
        safeSetJSON("local", PIECE_VISIBILITY_STORAGE_KEY, next);
        return next;
      });
    },
    [],
  );

  const reset = useCallback(() => {
    setPerkCount(DEFAULT_PERK_COUNT);
    setMode("perks");
    for (const slot of ["item", "addons", "offering"] as const) {
      safeSet("local", SLOT_STORAGE_KEY[slot], "1");
    }
    setLoadoutSlots(DEFAULT_LOADOUT_SLOTS);
    safeSet("local", GUARANTEE_TEACHABLES_STORAGE_KEY, "0");
    setGuaranteeTeachables(false);
    safeSetJSON("local", PIECE_VISIBILITY_STORAGE_KEY, DEFAULT_PIECE_VISIBILITY);
    setPieceVisibilityState(DEFAULT_PIECE_VISIBILITY);
  }, [setPerkCount, setMode]);

  const isDefault =
    perkCount === DEFAULT_PERK_COUNT &&
    mode === "perks" &&
    loadoutSlots.item &&
    loadoutSlots.addons &&
    loadoutSlots.offering &&
    !guaranteeTeachables &&
    pieceVisibility.perks &&
    pieceVisibility.item &&
    pieceVisibility.addon &&
    pieceVisibility.offering;

  const hydrate = useCallback(() => {
    setPerkCountState(loadPerkCount());
    setModeState(loadMode());
    setLoadoutSlots(loadLoadoutSlots());
    setGuaranteeTeachables(
      safeGet("local", GUARANTEE_TEACHABLES_STORAGE_KEY) === "1",
    );
    setPieceVisibilityState(
      safeGetJSON("local", PIECE_VISIBILITY_STORAGE_KEY, DEFAULT_PIECE_VISIBILITY),
    );
  }, []);

  return {
    perkCount,
    mode,
    loadoutSlots,
    guaranteeTeachables,
    pieceVisibility,
    setPerkCount,
    setMode,
    toggleLoadoutSlot,
    toggleGuaranteeTeachables,
    setPieceVisibility,
    showPerkCount: setPerkCountState,
    showMode: setModeState,
    hydrate,
    reset,
    isDefault,
  };
}
