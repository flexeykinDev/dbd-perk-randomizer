// How many days running someone has taken the Daily Challenge.
//
// Entirely local. The README's privacy position is that Firebase is used for
// exactly two things — the OBS overlay and the anonymous daily head count —
// and a streak is a per-person record, which is precisely the kind of thing
// that position exists to keep out of a shared database. It lives in this
// browser or nowhere.
//
// Every date here is a UTC calendar day, as `YYYY-MM-DD`, the same string
// todayUtcDateString produces and the same one the Daily's own seed is built
// from. Local time is never consulted. Mixing the two is how a feature like
// this breaks either side of midnight: a player in UTC+13 would see the
// challenge change while their streak still thought it was yesterday, and a
// player in UTC-8 the reverse.
//
// Pure, and given "today" rather than reading a clock, so the tests can walk
// a year of days in a loop and a caller can be honest about where the date
// came from.

/** A UTC calendar day, `YYYY-MM-DD`. */
export type UtcDay = string;

export interface StreakState {
  /** Days running, including today once it has been counted. */
  current: number;
  /** The best run this browser has ever recorded. Never goes down. */
  longest: number;
  /** The last day counted, or null before the first ever. */
  lastDay: UtcDay | null;
}

export const EMPTY_STREAK: StreakState = { current: 0, longest: 0, lastDay: null };

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Whether a string is a day this module can do arithmetic on.
 *
 *  Exported because the storage layer has to make the same judgement about a
 *  value some other version of the app may have written, and two different
 *  answers to "is this a day" is how a saved streak turns into NaN. */
export function isUtcDay(value: unknown): value is UtcDay {
  if (typeof value !== "string" || !DAY_PATTERN.test(value)) return false;
  // Rejects 2026-02-30 and friends: Date accepts them and rolls over, which
  // would make the difference between two "days" silently wrong.
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** Whole days from `from` to `to`, negative if `to` is earlier.
 *
 *  Both are parsed at midnight UTC, so this is a calendar-day difference and
 *  not an elapsed-hours one — no daylight saving, no timezone, and no
 *  fractional day to floor. */
export function daysBetween(from: UtcDay, to: UtcDay): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/**
 * The streak after taking the challenge on `today`.
 *
 * Called when the player enters Daily Challenge mode, not when the page
 * loads — the same distinction lib/daily-count.ts already draws between
 * participation and a visit.
 *
 * Four cases, and the awkward one is the fourth:
 *
 *   never played      today is day one
 *   same day again    nothing changes; taking it twice is still one day
 *   yesterday         the run continues
 *   anything else     the run is over, today starts a new one of 1
 *
 * "Anything else" deliberately includes a `today` that is *earlier* than the
 * last day recorded. A clock can go backwards — a device correcting itself
 * after being wrong, a VM resuming from a snapshot, someone setting the date
 * by hand — and the alternatives are worse than restarting: counting it as a
 * gap of minus-one would extend the run for a day that has not happened, and
 * ignoring it would freeze the streak until real time caught up. The longest
 * is never touched either way, so nothing is actually lost.
 */
export function advanceStreak(state: StreakState, today: UtcDay): StreakState {
  if (!isUtcDay(today)) return state;

  const previous = state.lastDay && isUtcDay(state.lastDay) ? state.lastDay : null;
  if (previous === today) return state;

  const gap = previous === null ? null : daysBetween(previous, today);
  const current = gap === 1 ? state.current + 1 : 1;

  return {
    current,
    longest: Math.max(state.longest, current),
    lastDay: today,
  };
}

/**
 * The streak as it should be *displayed* on `today`, without recording
 * anything.
 *
 * A run that ended is over the moment the day after it passes, whether or
 * not the player opens the site — so a streak of 6 last seen three days ago
 * has to read 0 now, not 6. Without this the number would keep claiming a
 * run that the calendar already ended, and would only correct itself when
 * the player next took the challenge.
 */
export function viewStreak(state: StreakState, today: UtcDay): StreakState {
  if (!isUtcDay(today)) return state;
  const previous = state.lastDay && isUtcDay(state.lastDay) ? state.lastDay : null;
  if (previous === null) return state;

  const gap = daysBetween(previous, today);
  // 0 is today (already counted) and 1 is yesterday (still live until the
  // day turns over again). Anything else means the run is finished.
  if (gap === 0 || gap === 1) return state;
  return { ...state, current: 0 };
}
