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

import { isAvailable } from "../lib/availability";

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
 * Decides which freshly-scraped rows are safe to ship, for a source that
 * documents content before it releases.
 *
 * The gate above only covers hand-written supplemental entries, because
 * every one of them was typed by a person who could be asked for a date.
 * Rows read off a wiki page have nobody to ask, and the scraper runs on a
 * schedule with no one watching, so the rule here has to hold without
 * anyone having noticed a Chapter was announced.
 *
 * Hence: trust is carried by what has already shipped. A character already
 * present in data/perks.json has been vetted — by a previous run, or by a
 * person adding it as a supplemental entry — and stays trusted forever. A
 * character nobody has seen before is held until someone writes down when
 * it releases. That's one line of JSON per Chapter, against the
 * alternative of an unattended run publishing a Chapter early.
 *
 * The second rule catches what the first can't: a *new perk for an
 * existing character*, which no character-level check would stop. Those
 * are held only when the wiki itself marks them as an upcoming patch —
 * that flag is unreliable on its own (it sits on Adrenaline and Sprint
 * Burst, both live for years, because their *descriptions* were written
 * ahead of a patch) but combined with "this perk has never shipped" it
 * stops being ambiguous: a perk that is both brand new and documented
 * against an unreleased patch is not something a player can own.
 *
 * Nothing here applies to a source that only documents released content —
 * see `publishesPreRelease` at the call site. Fandom keeps its existing
 * behaviour exactly, including picking up a new character on its own.
 */
/**
 * The characters the gate should treat as vetted, given what has shipped.
 *
 * This exists because shipping unreleased content early broke the old answer.
 * "Vetted" used to mean "present in the data", which was sound while the data
 * only ever held live content: a character was in the file because a previous
 * run or a person had cleared it. Now a file can also hold a Chapter that is
 * merely scheduled, and the first run after that wrote Terrifier into
 * perks.json then waved its twenty add-ons straight through as a known
 * character - the gate vouching for something on the strength of its own
 * earlier output.
 *
 * So a character is trusted unless everything it owns is still scheduled.
 * That keeps the loop closed in both directions: a Chapter stays untrusted
 * for as long as it is unreleased, however many runs happen in between, and
 * becomes trusted on its release day without anyone editing anything.
 *
 * `alsoKnown` is data/characters.json, the portrait map, which is merged
 * rather than rebuilt and so remembers characters that have dropped out of
 * the perk table (The Cenobite's perks became general and took it out of
 * perks.json, leaving its add-ons vouched for only by the file about to be
 * overwritten). It is subject to the same subtraction, because it is now
 * populated from scheduled rows too and would otherwise be the exact hole
 * described above.
 */
export function vettedCharacters(
  rows: ReadonlyArray<{ character?: string | null; availableFrom?: string }>,
  alsoKnown: readonly string[] = [],
  now?: Date,
): Set<string> {
  const live = new Set<string>();
  const scheduled = new Set<string>();
  for (const row of rows) {
    if (!row.character) continue;
    (isAvailable(row, now) ? live : scheduled).add(row.character);
  }
  const out = new Set([...alsoKnown, ...live]);
  for (const character of scheduled) {
    if (!live.has(character)) out.delete(character);
  }
  return out;
}

/** The slugs that count as already shipped — scheduled rows do not, for the
 *  same reason as above: a perk the last run published early has not been
 *  seen by a player yet, so it cannot vouch for itself. */
export function vettedSlugs(
  rows: ReadonlyArray<{ slug: string; availableFrom?: string }>,
  now?: Date,
): Set<string> {
  return new Set(rows.filter((row) => isAvailable(row, now)).map((row) => row.slug));
}

/** A row the gate withheld, and why.
 *
 *  `availableFrom` is the distinction that matters to the caller. It is set
 *  only when the hold is "this character is announced and releases on a date
 *  somebody wrote down" - a known quantity with a known end. The other two
 *  reasons (no recorded date; a brand-new perk against an unreleased patch)
 *  mean nobody has vetted the row at all, so they carry no date and the
 *  caller drops them exactly as before.
 *
 *  Shipping a dated row early is safe only because the client refuses to show
 *  it until the day - see isAvailable in lib/availability.ts. Without that
 *  half, this field would be a way to publish a Chapter early, which is the
 *  one thing this file exists to prevent. */
export interface HeldRow<T> {
  row: T;
  reason: string;
  availableFrom?: string;
}

export function gateScrapedRows<T>(
  rows: T[],
  {
    getCharacter,
    getSlug,
    isUpcoming,
    knownCharacters,
    knownSlugs,
    releaseDates,
    now = new Date(),
  }: {
    /** The row's character, or `null` for content that doesn't belong to
     *  one — items and offerings are shared by everybody, so there is no
     *  character whose release date could gate them, and only the
     *  new-and-upcoming rule below applies. */
    getCharacter: (row: T) => string | null;
    getSlug: (row: T) => string;
    isUpcoming: (row: T) => boolean;
    /** Characters already in the shipped data — the vetted set. */
    knownCharacters: ReadonlySet<string>;
    /** Perk slugs already in the shipped data. */
    knownSlugs: ReadonlySet<string>;
    /** character -> YYYY-MM-DD, for characters not yet in the data. */
    releaseDates: Record<string, string>;
    now?: Date;
  },
): { live: T[]; held: HeldRow<T>[] } {
  const live: T[] = [];
  const held: HeldRow<T>[] = [];

  for (const row of rows) {
    const character = getCharacter(row);
    if (character !== null && !knownCharacters.has(character)) {
      const releasedAt = releaseDates[character];
      if (!releasedAt) {
        held.push({
          row,
          reason:
            `"${character}" has never shipped and has no entry in ` +
            `data/character-release-dates.json — add its release date to let it through`,
        });
        continue;
      }
      // A date that IS present is held to the same standard as a
      // supplemental one: malformed throws rather than being guessed at.
      if (!isReleased(releasedAt, `character "${character}"`, now)) {
        /* Dated, so the caller may ship it early and let it surface on the
           day - see HeldRow.availableFrom. The other two holds carry no
           date and stay dropped. */
        held.push({
          row,
          reason: `"${character}" releases ${releasedAt}`,
          availableFrom: releasedAt,
        });
        continue;
      }
    }

    if (isUpcoming(row) && !knownSlugs.has(getSlug(row))) {
      held.push({
        row,
        reason: `new perk documented against an unreleased patch`,
      });
      continue;
    }

    live.push(row);
  }

  return { live, held };
}

/**
 * Splits entries into those that count as live and those still pending, so
 * callers can log what was withheld instead of dropping it silently — a
 * scrape that quietly ships fewer add-ons than the wiki lists is exactly
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
