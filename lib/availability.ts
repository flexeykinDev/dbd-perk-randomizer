// Content that is in the data but not in the game yet.
//
// The scrapers used to drop an announced Chapter on the floor and pick it up
// on the next run after release. That is correct and it is also up to a week
// late: the weekly job is what decides when a new killer appears on the site,
// not the game's release day. Someone opening the randomizer the evening a
// Chapter drops found nothing there.
//
// So a dated row now ships with the build, carrying the day it becomes real,
// and this is the one place that decides whether it counts yet. The static
// export already in front of a visitor starts including it on the day, with
// no scrape, no deploy and nothing to remember.
//
// What that trades away is worth saying plainly: the values come from the PTB
// build, and BHVR does change numbers between PTB and live. The first scrape
// after release corrects them. Until then the site may show a PTB number for
// a perk that shipped with a different one - which is the deal, because the
// alternative is showing nothing at all.
//
// Only ever applied to content that a person dated by hand in
// data/character-release-dates.json. Anything the gate held for any other
// reason is still dropped at scrape time and never reaches the client.

/** The subset of a Perk or LoadoutPiece this cares about. */
export interface Datable {
  /** YYYY-MM-DD, absent for everything already in the game. */
  availableFrom?: string;
}

/**
 * True when `piece` is in the game as of `now`.
 *
 * Compared as UTC calendar days rather than instants, matching
 * scripts/release-gate.ts: a Chapter that goes live "on 24 November" should
 * count for the whole of that day wherever the visitor is, and a raw Date
 * comparison would get that wrong either side of midnight.
 *
 * A malformed date reads as NOT available. That is the opposite of the
 * scraper's rule, which throws - and deliberately so. The scraper runs where
 * someone will read the failure; this runs in a stranger's browser, where
 * there is nobody to tell and the only choices are "hide it" or "show
 * unreleased content". Hiding is the safe one, and the scrape-time guard
 * means a malformed date cannot get this far anyway.
 */
export function isAvailable(piece: Datable, now: Date = new Date()): boolean {
  /* `== null` rather than falsy: an absent date means "already in the game",
     but a date that is PRESENT and empty is malformed, and falls through to
     the regex below to be hidden like any other malformed value. */
  if (piece.availableFrom == null) return true;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(piece.availableFrom.trim());
  if (!match) return false;
  const from = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return from <= today;
}

/** `rows` minus anything not in the game yet. */
export function available<T extends Datable>(rows: readonly T[], now?: Date): T[] {
  return rows.filter((row) => isAvailable(row, now));
}
