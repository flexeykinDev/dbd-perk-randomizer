"use client";

import { useCallback, useState } from "react";
import {
  advanceStreak,
  EMPTY_STREAK,
  isUtcDay,
  viewStreak,
  type StreakState,
} from "./daily-streak";
import { safeGetJSON, safeSetJSON } from "./safe-storage";
import { todayUtcDateString } from "./seeded-random";

/* The Daily Challenge streak, stored and shown.
 *
 * The arithmetic is lib/daily-streak.ts and takes "today" as an argument;
 * this is the only place that asks what day it actually is, and it asks
 * todayUtcDateString — the same function the Daily's own seed is built from,
 * so the streak and the challenge can never disagree about which day it is.
 *
 * localStorage and nothing else. The README's privacy position is that
 * Firebase carries exactly two things, and a per-person record is what that
 * position exists to keep out of a shared database. Nothing here leaves the
 * browser.
 *
 * SSR-safe defaults, corrected by `hydrate` from the board's mount effect —
 * the same rule the rest of the persisted state here follows, and not a
 * stylistic one: reading storage during the first client render puts a
 * streak on screen where the server rendered none, and React throws a
 * hydration mismatch for every returning player.
 */

const STORAGE_KEY = "dbd-randomizer:daily-streak";

/** Reads defensively: any field could have been written by an older or a
 *  newer version of the app, or edited by hand. A streak that cannot be
 *  understood is no streak, never a NaN on screen. */
function load(): StreakState {
  const raw = safeGetJSON<Partial<StreakState> | null>("local", STORAGE_KEY, null);
  if (!raw || typeof raw !== "object") return EMPTY_STREAK;

  const whole = (value: unknown) =>
    typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0;

  const current = whole(raw.current);
  const longest = whole(raw.longest);
  return {
    current,
    // The record cannot be smaller than the run it is supposed to bound; a
    // payload saying otherwise is repaired rather than believed.
    longest: Math.max(longest, current),
    lastDay: isUtcDay(raw.lastDay) ? raw.lastDay : null,
  };
}

export interface DailyStreakController {
  /** What to show: a run the calendar has already ended reads as 0 even
   *  though the stored value still remembers it. */
  streak: StreakState;
  /** Call when the player enters Daily Challenge mode — participation, not
   *  a visit, the same line lib/daily-count.ts draws. Safe to call twice in
   *  a day; the second call changes nothing. */
  record: () => void;
  /** Restores the saved streak, at mount. */
  hydrate: () => void;
}

export function useDailyStreak(): DailyStreakController {
  const [stored, setStored] = useState<StreakState>(EMPTY_STREAK);
  const [today, setToday] = useState<string | null>(null);

  const hydrate = useCallback(() => {
    setStored(load());
    // Asked once at mount rather than per render: a component that recomputed
    // "today" every render would change what it shows mid-session at UTC
    // midnight, halfway through a roll.
    setToday(todayUtcDateString());
  }, []);

  /* Every setter here is a plain value-set. StrictMode double-invokes a
     setState updater to catch impurity, so a storage write folded into one
     fires twice per press — see the same note in lib/use-battle-royale.ts.
     Do not move the safeSetJSON back inside an updater. */
  const record = useCallback(() => {
    const day = todayUtcDateString();
    const next = advanceStreak(stored, day);
    setToday(day);
    if (next === stored) return; // already counted today
    setStored(next);
    safeSetJSON("local", STORAGE_KEY, next);
  }, [stored]);

  return {
    streak: today ? viewStreak(stored, today) : EMPTY_STREAK,
    record,
    hydrate,
  };
}
