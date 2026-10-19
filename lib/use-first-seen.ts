"use client";

// "This is new" — said once, to each person, and never again.
//
// A badge that shines on every visit is an advertisement; one that shines until
// you have seen the thing is a signpost. The difference is entirely in whether
// it remembers, so that is all this does: a flag per feature, set the first time
// the thing is used, read back on later visits.
//
// Deliberately not a date window like isNewPerk's thirty days. A perk is new
// relative to the game's calendar and stops being new for everyone at once; a
// tool is new relative to YOU, and someone arriving next year has still never
// seen it. Tying this to a date would have shown nothing to exactly the people
// who needed telling.
import { useCallback, useEffect, useState } from "react";
import { safeGet, safeSet } from "./safe-storage";

export interface FirstSeen {
  /** True once hydration has run AND the flag is absent. Never true during the
   *  server render or the first client render. */
  isNew: boolean;
  /** Marks it seen. Idempotent, and safe to call from a click handler that is
   *  also navigating away. */
  markSeen: () => void;
}

/**
 * @param key A stable storage key, e.g. "dbd-randomizer:seen-clock". Changing
 *            it re-announces the feature to everyone, which is occasionally
 *            what you want and usually a mistake.
 */
export function useFirstSeen(key: string): FirstSeen {
  /* Starts false, not true. The server renders a window-less page and cannot
     know whether this visitor has seen anything, so a `true` default would put
     the badge in the server's HTML and take it away on hydration — a flash for
     everyone who had already dismissed it, which is the opposite of the point.
     Absent-means-new is resolved after mount, like every other persisted thing
     here. */
  const [isNew, setIsNew] = useState(false);

  useEffect(() => {
    function hydrate() {
      setIsNew(safeGet("local", key) !== "1");
    }
    hydrate();
  }, [key]);

  const markSeen = useCallback(() => {
    safeSet("local", key, "1");
    setIsNew(false);
  }, [key]);

  return { isNew, markSeen };
}
