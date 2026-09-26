"use client";

import { useCallback, useState } from "react";
import { DEFAULT_COHERENCE, isCoherenceLevel, type CoherenceLevel } from "./coherence";
import { safeGet, safeSet } from "./safe-storage";

/* How much the roll leans toward a build that hangs together.
 *
 * One number, so this is smaller than the other hooks here — but it is a
 * hook rather than a useState on the board for the same reason they are: the
 * saved value has to be read at the right moment, and "the right moment" is
 * not first render.
 *
 * SSR-safe defaults, corrected by `hydrate` from the board's mount effect.
 * Reading storage in a lazy useState initialiser happens during the client's
 * first render, before hydration reconciles against the server's window-less
 * HTML, and React then throws a hydration mismatch for every returning
 * visitor whose saved value differs from the default. That is not
 * hypothetical: it shipped that way in the squad mode added just before this
 * and had to be found in a dev console.
 */

const STORAGE_KEY = "dbd-randomizer:coherence";

export interface CoherenceController {
  level: CoherenceLevel;
  setLevel: (next: CoherenceLevel) => void;
  /** Restores the saved level, at mount. */
  hydrate: () => void;
}

export function useCoherence(): CoherenceController {
  const [level, setLevelState] = useState<CoherenceLevel>(DEFAULT_COHERENCE);

  const setLevel = useCallback((next: CoherenceLevel) => {
    if (!isCoherenceLevel(next)) return;
    setLevelState(next);
    safeSet("local", STORAGE_KEY, String(next));
  }, []);

  const hydrate = useCallback(() => {
    const stored = safeGet("local", STORAGE_KEY);
    if (stored === null) return;
    const parsed = Number(stored);
    // A value written by another version of the app, or edited by hand, must
    // leave the board on the default rather than on something the roll
    // cannot interpret.
    if (isCoherenceLevel(parsed)) setLevelState(parsed);
  }, []);

  return { level, setLevel, hydrate };
}
