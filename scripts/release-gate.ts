// Keeps not-yet-released content out of the shipped data.
//
// Fandom only documents a character once it's live, so the original
// scrapers never needed this. deadbydaylight.wiki.gg — where every
// supplemental entry in data/supplemental-*.json comes from, and the
// likely primary source if the EN scrape ever moves there — does the
// opposite: it publishes a full page (perks, add-ons, icons, the lot) as
// soon as a Chapter is announced, weeks before it ships. Two real cases
// caught by hand while adding the current supplemental data: The Judgment
// and Aurora Stardotter, both fully documented on wiki.gg and both dated
// 25 August 2026. Rolling either into a build would tell a player to run
// a perk they cannot own.
//
// So every supplemental entry carries an explicit `releasedAt`, and this
// is the one place that decides whether it counts as live yet.

/** Thrown for a malformed or missing date so a bad entry can never be
 *  silently swallowed — see the note on `isReleased`. */
export class ReleaseDateError extends Error {}

/**
 * True when `releasedAt` is on or before `now`.
 *
 * A missing or unparseable date throws rather than defaulting either way.
 * Defaulting to "released" would reintroduce exactly the bug this exists
 * to prevent, and defaulting to "not released" would silently drop a
 * hand-authored entry, leaving someone to wonder why the character they
 * just added never shows up. Throwing fails the scrape loudly, names the
 * offending entry, and is trivially fixed by filling the field in.
 *
 * Dates are compared as UTC calendar days, not instants: a Chapter that
 * goes live "on 25 August" should count as released for the whole of that
 * day regardless of the runner's timezone, which a raw Date comparison
 * against `new Date()` would get wrong either side of midnight.
 */
export function isReleased(
  releasedAt: string | undefined,
  label: string,
  now: Date = new Date(),
): boolean {
  if (!releasedAt) {
    throw new ReleaseDateError(
      `${label} has no "releasedAt" — every supplemental entry needs one so ` +
        `unreleased content can't ship (see scripts/release-gate.ts).`,
    );
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(releasedAt.trim());
  if (!match) {
    throw new ReleaseDateError(
      `${label} has an unparseable "releasedAt" (${JSON.stringify(releasedAt)}) — expected YYYY-MM-DD.`,
    );
  }
  const released = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return released <= today;
}

/**
 * Splits entries into those that count as live and those still pending,
 * so callers can log what was withheld instead of dropping it silently —
 * a scrape that quietly ships fewer perks than the wiki lists is exactly
 * the kind of thing nobody notices until a player does.
 */
export function partitionByRelease<T>(
  entries: T[],
  getDate: (entry: T) => string | undefined,
  getLabel: (entry: T) => string,
  now: Date = new Date(),
): { live: T[]; pending: { entry: T; releasedAt: string }[] } {
  const live: T[] = [];
  const pending: { entry: T; releasedAt: string }[] = [];
  for (const entry of entries) {
    if (isReleased(getDate(entry), getLabel(entry), now)) {
      live.push(entry);
    } else {
      pending.push({ entry, releasedAt: getDate(entry)! });
    }
  }
  return { live, pending };
}
