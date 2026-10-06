// The short numeric ids that make share links work, and the one promise
// they carry: an id, once handed out, means that same perk forever.
//
// Every Share link, every Twitch !paste, every preset URL is a list of
// these numbers. Reassign one and every link ever sent starts pointing at
// a different perk — with no error, no broken image, nothing to notice.
// The build simply isn't the build that was shared. That is the same
// silent-and-confidently-wrong failure as the Fog Vial add-ons, except it
// would land on links already out in the world.
//
// Both scrapers currently get this right: they load the committed map and
// only assign ids to keys that don't have one. Nothing enforced it, which
// is what this is for. The baseline is the committed JSON rather than
// anything the scraper produces, for the same reason the census uses the
// shipped data — a guard that reads what the run is about to overwrite is
// only checking the run against itself.
import { existsSync, readFileSync } from "node:fs";

export type IdMap = Record<string, number>;

export interface IdProblem {
  kind: "reassigned" | "dropped" | "duplicate";
  key: string;
  detail: string;
}

/** Everything wrong with `next` relative to `previous`, worst kind first.
 *  An empty array means every promise still holds. */
export function idProblems(previous: IdMap, next: IdMap): IdProblem[] {
  const problems: IdProblem[] = [];

  for (const [key, id] of Object.entries(previous)) {
    if (!(key in next)) {
      // Dropping a key frees its number to be handed to something else on
      // a later run, so this is a reassignment with a delay on it.
      problems.push({
        kind: "dropped",
        key,
        detail: `had id ${id}, now absent — the number could be reused by something else later`,
      });
    } else if (next[key] !== id) {
      problems.push({
        kind: "reassigned",
        key,
        detail: `id ${id} -> ${next[key]}`,
      });
    }
  }

  const seen = new Map<number, string>();
  for (const [key, id] of Object.entries(next)) {
    const owner = seen.get(id);
    if (owner !== undefined) {
      problems.push({ kind: "duplicate", key, detail: `id ${id} is also used by "${owner}"` });
    } else {
      seen.set(id, key);
    }
  }

  // Reassignments first: they are the ones already breaking live links.
  const order = { reassigned: 0, duplicate: 1, dropped: 2 } as const;
  return problems.sort((a, b) => order[a.kind] - order[b.kind]);
}

function readMap(path: string): IdMap | null {
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as IdMap) : null;
  } catch {
    return null;
  }
}

/**
 * Stops the run if the id map about to be written breaks a link that has
 * already been shared. Call before writing, so a failure leaves the
 * committed map intact.
 *
 * @param label What the ids identify, for the message ("perk").
 * @param path  The committed map this run will overwrite.
 * @param next  The map about to be written.
 * @param keys  Everything that must have an id — a shipped row with no id
 *   silently disappears from any link it should have been part of.
 */
export function guardIdStability(label: string, path: string, next: IdMap, keys: readonly string[]): void {
  const missing = keys.filter((key) => next[key] === undefined);
  if (missing.length > 0) {
    throw new Error(
      `${missing.length} ${label}s have no share id (e.g. ${missing.slice(0, 5).join(", ")}).\n` +
        `  Anything without one is silently dropped from every share link it belongs in.`,
    );
  }

  const previous = readMap(path);
  if (!previous) {
    console.log(`  ${label} ids: ${Object.keys(next).length}, nothing to compare against yet`);
    return;
  }

  const problems = idProblems(previous, next);
  if (problems.length === 0) {
    const added = Object.keys(next).length - Object.keys(previous).length;
    console.log(`  ${label} ids: ${Object.keys(next).length} stable${added > 0 ? `, ${added} new` : ""}`);
    return;
  }

  throw new Error(
    `${label} ids changed in ways that break links already shared, against ${path}:\n` +
      problems.map((p) => `    ${p.kind}: "${p.key}" — ${p.detail}`).join("\n") +
      `\n  Ids are permanent: every Share link and !paste command is a list of them.\n` +
      `  A rebuilt map is almost always the cause — the map must be loaded and\n` +
      `  extended, never regenerated.`,
  );
}

/* ------------------------------------------------------------------------ *
 * The other half of the promise.
 *
 * Everything above protects slug -> id: an id, once handed out, never moves
 * to something else. That turns out to be only half of what a share link
 * needs, because a slug can keep its id and stop meaning what it meant.
 *
 * Found on 6 October 2026, on a routine loadout scrape. Two add-ons are both
 * called "Mirror Shards" — Chucky's and the Slasher's — and the scraper gives
 * the first one it meets the bare slug and suffixes the rest. The wiki's
 * ordering changed, so they swapped:
 *
 *     committed   addon:mirror-shards          = Good Guy   (id 501)
 *                 addon:mirror-shards-slasher  = Slasher    (id 940)
 *     scraped     addon:mirror-shards          = Slasher    (id 501)
 *                 addon:mirror-shards-good-guy = Good Guy   (id 1044, new)
 *
 * Every id check passed. 501 still pointed at `addon:mirror-shards`, nothing
 * was reassigned, nothing was dropped from the map — the run reported "1044
 * stable, 1 new" and would have been auto-merged by update-perks.yml. And yet
 * id 501, which is in share links and saved pools already out in the world,
 * had quietly become a different add-on.
 *
 * So this compares what the slugs NAME, not what they are numbered. A slug
 * whose owner changes is either a rename worth recording in the aliases file
 * or a disambiguation that has become unstable, and both need a person.
 * ------------------------------------------------------------------------ */

/** The identifying facts about a piece, as the shipped data records them. */
export interface PieceIdentity {
  /** Who it belongs to. The field that moved in the Mirror Shards swap. */
  character?: string | null;
  /** English name. A slug keeping its id while renaming is a real rename. */
  name?: string;
}

export interface IdentityProblem {
  key: string;
  field: string;
  detail: string;
}

/** Slugs that still exist but no longer name the same thing.
 *
 *  Only compares keys present on both sides: a key that disappeared is already
 *  a "dropped" id problem, and a new key cannot have changed meaning. */
export function identityProblems(
  previous: Record<string, PieceIdentity>,
  next: Record<string, PieceIdentity>,
): IdentityProblem[] {
  const problems: IdentityProblem[] = [];
  for (const [key, before] of Object.entries(previous)) {
    const after = next[key];
    if (!after) continue;
    for (const field of ["character", "name"] as const) {
      const a = before[field] ?? null;
      const b = after[field] ?? null;
      if (a !== b) {
        problems.push({ key, field, detail: `${field} ${JSON.stringify(a)} -> ${JSON.stringify(b)}` });
      }
    }
  }
  return problems;
}

/** Throws when a slug has changed what it names, naming every one of them. */
export function guardIdentityStability(
  label: string,
  path: string,
  previous: Record<string, PieceIdentity> | null,
  next: Record<string, PieceIdentity>,
): void {
  if (!previous) {
    console.log(`  ${label} identities: nothing to compare against yet`);
    return;
  }
  const problems = identityProblems(previous, next);
  if (problems.length === 0) {
    console.log(`  ${label} identities: ${Object.keys(next).length} unchanged`);
    return;
  }
  throw new Error(
    `${problems.length} ${label}${problems.length === 1 ? "" : "s"} kept its slug but changed what it names, against ${path}:\n` +
      problems.map((p) => `    "${p.key}" — ${p.detail}`).join("\n") +
      `\n  The id stays put while the thing behind it moves, so every share link and\n` +
      `  saved pool carrying that slug now resolves to something else — with no error\n` +
      `  and nothing to notice.\n` +
      `  If this is a rename, record it in the aliases file and update the data by hand.\n` +
      `  If two pieces share a name, the disambiguation suffix has become unstable and\n` +
      `  the fix belongs in the scraper, not in the data.`,
  );
}
