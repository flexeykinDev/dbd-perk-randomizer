// A before/after headcount taken across a scrape, so a category that
// quietly empties out has to be acknowledged instead of just shipping.
//
// The add-on count has gone 847 -> 207 -> 887 -> 907 -> 912 across the
// source migration and nobody noticed at the time, because the only number
// printed was the total and the total kept looking plausible. Totals are
// exactly the wrong thing to watch: the Fog Vial bug did not change the
// total at all. Real Firecrackers were dropped and Fog Vials were added in
// their place, so the sum stayed put while two whole item types were wrong.
//
// So the census counts *categories* — per role, per item type, per
// character — and compares them against what is already committed in
// data/. That baseline choice is deliberate: an earlier guard in this
// project compared scraper output against a file the scraper itself had
// written, which always agrees with itself. Reading the previous counts
// out of the shipped data means the thing being compared against is
// whatever is in git, which no run of the scraper can quietly move.
//
// Growth is never questioned — new chapters are the normal case. Any
// shrink stops the run, because content genuinely leaving the game is rare
// (a licence lapsing) and worth a human look when it happens. That is what
// --allow-shrink is for.
import { existsSync, readFileSync } from "node:fs";

/** Category name -> how many rows fell into it. */
export type Census = Record<string, number>;

/** Splits one row into every category it should be counted under. A row
 *  normally lands in several: a survivor Flashlight add-on counts toward
 *  the total, toward survivor add-ons, and toward flashlight add-ons. */
export type Categorise<T> = (row: T) => string[];

/** Set on the command line (`npm run scrape:loadout -- --allow-shrink`) to
 *  accept a drop that has been checked by hand. */
const ALLOW_SHRINK = process.argv.includes("--allow-shrink");

export function takeCensus<T>(rows: readonly T[], categorise: Categorise<T>): Census {
  const counts: Census = { total: rows.length };
  for (const row of rows) {
    for (const category of categorise(row)) {
      counts[category] = (counts[category] ?? 0) + 1;
    }
  }
  return counts;
}

/** The previously shipped rows for a file, or null if there aren't any —
 *  a first run has nothing to compare against and shouldn't pretend to. */
export function previousRows<T>(path: string): T[] | null {
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return Array.isArray(parsed) ? (parsed as T[]) : null;
  } catch {
    // A corrupt or half-written file is not a baseline. Better to scrape
    // without a guard than to compare against nonsense and either block a
    // good run or wave through a bad one.
    return null;
  }
}

export interface CensusChange {
  category: string;
  before: number;
  after: number;
}

/** Every category that lost rows, worst first. Categories that grew or
 *  held steady aren't interesting; categories that vanished entirely are
 *  reported as a drop to zero rather than being silently absent.
 *
 *  "Worst" is the *proportion* lost, not the count. Sorting by count puts
 *  `total` and the role buckets at the top of every report, since they
 *  contain everything and so always shed the most rows — which is the
 *  least diagnostic thing to read first. A category that emptied out is
 *  the finding; the aggregates are just its shadow. */
export function shrinkages(before: Census, after: Census): CensusChange[] {
  const lostShare = (c: CensusChange) => (c.before - c.after) / c.before;
  return Object.entries(before)
    .map(([category, was]) => ({ category, before: was, after: after[category] ?? 0 }))
    .filter((c) => c.after < c.before)
    .sort((a, b) => lostShare(b) - lostShare(a) || b.before - b.after - (a.before - a.after));
}

/**
 * Compares a finished scrape against what is already in `path` and stops
 * the run if anything shrank.
 *
 * Call this *before* writing, so a run that trips the guard leaves the
 * good data in place — a half-replaced data directory is worse than no
 * run at all, and the GitHub Action commits whatever it finds.
 *
 * @param label      What's being counted, for the message ("add-ons").
 * @param path       The committed JSON this scrape will overwrite.
 * @param rows       The rows about to be written.
 * @param categorise How to bucket a row; see Categorise.
 */
export function guardAgainstShrink<T>(
  label: string,
  path: string,
  rows: readonly T[],
  categorise: Categorise<T>,
): void {
  const previous = previousRows<T>(path);
  if (!previous) {
    console.log(`  ${label}: ${rows.length} (nothing to compare against yet)`);
    return;
  }

  const before = takeCensus(previous, categorise);
  const after = takeCensus(rows, categorise);
  const lost = shrinkages(before, after);
  const gained = Object.entries(after).filter(([category, n]) => n > (before[category] ?? 0));

  if (lost.length === 0) {
    const grew = gained.length > 0 ? `, ${gained.length} categor${gained.length === 1 ? "y" : "ies"} grew` : "";
    console.log(`  ${label}: ${rows.length}, nothing lost${grew}`);
    return;
  }

  const detail = lost
    .map(({ category, before: was, after: now }) => `    ${category}: ${was} -> ${now}${now === 0 ? "  (empty)" : ""}`)
    .join("\n");
  const message =
    `${label} shrank against the committed data in ${path}:\n${detail}\n` +
    `  Total went ${previous.length} -> ${rows.length}.\n` +
    `  A category emptying out usually means the page's markup moved and a\n` +
    `  parser stopped matching, not that the content left the game. Check the\n` +
    `  wiki page for the categories above. If the loss is real, re-run with\n` +
    `  --allow-shrink to accept it.`;

  if (ALLOW_SHRINK) {
    console.warn(`  ${message}\n  (accepted: --allow-shrink)`);
    return;
  }
  throw new Error(message);
}
