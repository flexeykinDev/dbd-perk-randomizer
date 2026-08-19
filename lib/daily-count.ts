"use client";

import { useSyncExternalStore } from "react";
import { increment, onValue, ref, update } from "firebase/database";
import { getObsDatabase } from "./firebase";
import { safeGet, safeSet } from "./safe-storage";
import { todayUtcDateString } from "./seeded-random";

// "N players took today's challenge" — the one number on this site that
// means anything only because other people are also looking at it. The
// Daily Challenge is already the same build for everybody who opens it, so
// it was the one feature where a shared count adds something a local one
// couldn't.
//
// Deliberately counts *participation*, not visits. Incrementing on page
// load would have been simpler, and would have meant the number said
// "people who opened the site" while the label said "played today" — and it
// would have written to a shared database on behalf of every passer-by who
// never touched the feature. It counts when someone actually switches the
// board into Daily Challenge mode, which is a thing they chose to do.
//
// Anonymous by construction: the only thing stored is a per-day integer.
// There is no per-visitor record, here or in the browser beyond the "did I
// already count today" flag below.

/** Bumped once per browser per day, so refreshing the page or toggling the
 *  mode off and on again doesn't inflate the number. */
const COUNTED_KEY = "dbd-randomizer:daily-counted";

const dayPath = (day: string) => `daily-challenge/${day}`;

/**
 * Records that this browser took part in today's challenge.
 *
 * Silent on every failure. Firebase is optional for this site — the OBS
 * overlay degrades to same-profile sync without it (see lib/firebase.ts) —
 * and a counter matters far less than that. An ad-blocker, an offline tab,
 * or database rules that don't grant this path should cost the player
 * nothing at all.
 */
export function recordDailyParticipation(): void {
  const today = todayUtcDateString();
  if (safeGet("local", COUNTED_KEY) === today) return;

  const db = getObsDatabase();
  if (!db) return;
  try {
    // A server-side atomic increment rather than read-then-write: several
    // players taking the challenge at once would otherwise each write the
    // same "current + 1" and lose each other's.
    void update(ref(db, dayPath(today)), { count: increment(1) }).catch(() => {});
    safeSet("local", COUNTED_KEY, today);
  } catch {
    // ignored — see above
  }
}

// A module-level store rather than per-component state, so the hook below
// can be useSyncExternalStore. Subscribing from an effect and calling
// setState from the callback is the pattern React now flags
// (react-hooks/set-state-in-effect) — a listener that fires synchronously
// on subscribe, which this one does whenever Firebase is unavailable,
// causes exactly the cascading render the rule exists to prevent.
//
// `null` means "nothing worth showing": Firebase unavailable, the read
// denied, or the day not started yet. Callers render nothing rather than a
// zero, since "0 players today" reads as a dead site when it usually means
// the UTC day turned over minutes ago.
let count: number | null = null;
let listeners: (() => void)[] = [];
let detach: (() => void) | null = null;

function publish(next: number | null): void {
  if (next === count) return; // keeps getSnapshot stable, as the hook requires
  count = next;
  for (const listener of listeners) listener();
}

/** Opens the Firebase listener on the first subscriber and closes it after
 *  the last one leaves, so a visitor who never opens the Daily Challenge
 *  never opens a connection for it either. */
function subscribe(onStoreChange: () => void): () => void {
  listeners.push(onStoreChange);
  if (listeners.length === 1) {
    const db = getObsDatabase();
    if (db) {
      try {
        detach = onValue(
          ref(db, `${dayPath(todayUtcDateString())}/count`),
          (snapshot) => {
            const value = snapshot.val();
            publish(typeof value === "number" && value > 0 ? value : null);
          },
          () => publish(null),
        );
      } catch {
        publish(null);
      }
    }
  }
  return () => {
    listeners = listeners.filter((l) => l !== onStoreChange);
    if (listeners.length === 0) {
      detach?.();
      detach = null;
    }
  };
}

const getSnapshot = (): number | null => count;
/** The server render and the first client render have no count either way,
 *  and returning the live value here would risk a hydration mismatch. */
const getServerSnapshot = (): number | null => null;

/** Today's participant count, or null when there is nothing to show.
 *
 *  Call this from a component that is only mounted while the count is
 *  actually on screen — mounting is what opens the Firebase listener. */
export function useDailyCount(): number | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
