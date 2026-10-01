"use client";

// Whether the setup controls are showing, remembered between visits.
//
// The board carried five rows of controls above the build. Three of them —
// character, theme, coherence, pools, overlay, the More menu — are things
// you set once and stop thinking about, and they were given the same pill
// treatment and the same weight as the controls you change between rolls.
// Nothing read as more important than anything else, and the build started
// a long way down.
//
// Collapsed on a first visit, because that is where the gain is and it is
// the honest default for someone who has not set anything yet. After that
// it follows whatever you actually do.
import { useCallback, useState } from "react";
import { safeGet, safeSet } from "./safe-storage";

const STORAGE_KEY = "dbd-randomizer:setup-open";

export interface SetupDisclosure {
  open: boolean;
  toggle: () => void;
  /** Reads the saved state. Called once after mount — a lazy useState
   *  initialiser would read localStorage during the server render and
   *  hydrate to a different tree than the server sent. */
  hydrate: () => void;
}

export function useSetupDisclosure(): SetupDisclosure {
  const [open, setOpen] = useState(false);

  const toggle = useCallback(() => {
    // The write stays OUT of the updater: StrictMode double-invokes
    // updaters, and a storage write is a side effect. usePersistedSet
    // persists inside its updater on purpose — but it is avoiding a
    // save-on-every-render effect for a value that changes in bulk, which
    // a single boolean toggled by a click does not need.
    const next = !open;
    safeSet("local", STORAGE_KEY, next ? "1" : "0");
    setOpen(next);
  }, [open]);

  const hydrate = useCallback(() => {
    setOpen(safeGet("local", STORAGE_KEY) === "1");
  }, []);

  return { open, toggle, hydrate };
}
