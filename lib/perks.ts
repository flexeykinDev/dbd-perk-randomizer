import perksData from "@/data/perks.json";
import metaData from "@/data/meta.json";
import charactersData from "@/data/characters.json";
import slugAliasData from "@/data/perk-slug-aliases.json";
import type { Perk, PerkRole, PerksMeta } from "./types";
import { createSeededRandom, shuffle } from "./seeded-random";

export const perks: Perk[] = perksData as Perk[];
export const perksMeta: PerksMeta = metaData as PerksMeta;
const characterPortraits: Record<string, string> = charactersData;

export function getCharacterPortrait(character: string): string | undefined {
  return characterPortraits[character];
}

const perksBySlug = new Map(perks.map((perk) => [perk.slug, perk]));

/** Retired slug -> current one, for perks the game has renamed. See
 *  data/perk-slug-aliases.json, which the scraper maintains. */
const slugAliases: Record<string, string> = (
  slugAliasData as { aliases?: Record<string, string> }
).aliases ?? {};

const NEW_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export function getPerksByRole(role: PerkRole): Perk[] {
  return perks.filter((perk) => perk.role === role);
}

/** Looks a perk up by slug, following a rename if the game has since given
 *  it a different name.
 *
 *  The fallback exists because slugs are durable identifiers here: they sit
 *  in share links (via perk IDs), in the saved pool and favourites in
 *  localStorage, and in build history. When a licence lapses the game
 *  renames the perk — Decisive Strike is now Will to Live — and without
 *  this every link and saved pool naming the old one would silently lose
 *  that perk. */
export function getPerkBySlug(slug: string): Perk | undefined {
  const perk = perksBySlug.get(slug);
  if (perk) return perk;
  const renamed = slugAliases[slug];
  return renamed ? perksBySlug.get(renamed) : undefined;
}

/** Every character with at least one teachable perk for `role` — ".All"
 *  (perks that shipped with the base game, not tied to any one character's
 *  teachables, see Perk.character) is deliberately excluded since it isn't
 *  a character a "Random Character" roll could ever land on. */
export function getCharactersForRole(role: PerkRole): string[] {
  return [...new Set(perks.filter((p) => p.role === role && p.character !== ".All").map((p) => p.character))].sort();
}

export function getTeachablePerks(role: PerkRole, character: string): Perk[] {
  return perks.filter((p) => p.role === role && p.character === character);
}

export function isNewPerk(perk: Perk): boolean {
  return Date.now() - new Date(perk.addedAt).getTime() < NEW_WINDOW_MS;
}

export function getAvailablePool(
  role: PerkRole,
  excludedSlugs?: ReadonlySet<string>,
): Perk[] {
  const fullPool = getPerksByRole(role);
  if (!excludedSlugs || excludedSlugs.size === 0) return fullPool;
  return fullPool.filter((perk) => !excludedSlugs.has(perk.slug));
}

// How many extra "tickets" a favorited perk gets in the weighted draw below
// — e.g. 4x means a favorited perk is roughly 4x as likely to be picked as
// a non-favorited one on any given slot, without ever *guaranteeing* it
// appears (it's still possible to roll a build with none of your favorites,
// same as a real loot table — a hard guarantee would make "favorite everything"
// behave identically to "favorite nothing", which defeats the point).
const FAVORITE_WEIGHT = 4;

export function getRandomPerks(
  role: PerkRole,
  count: number,
  excludedSlugs?: ReadonlySet<string>,
  random: () => number = Math.random,
  favoriteSlugs?: ReadonlySet<string>,
): Perk[] {
  // Never pull from outside the caller's excluded-respecting pool, even when
  // it's smaller than `count` — silently topping up from excluded perks
  // would defeat the entire point of excluding them. Callers should check
  // getAvailablePool().length themselves beforehand (see randomizer-board.tsx's
  // `poolExhausted`) and show an explicit "not enough perks" state instead of
  // calling this with a pool too small to fill the request.
  const pool = getAvailablePool(role, excludedSlugs);

  if (!favoriteSlugs || favoriteSlugs.size === 0) {
    return shuffle(pool, random).slice(0, count);
  }

  // Weighted-without-replacement via ticket duplication: give each favorited
  // perk multiple entries in the array before shuffling, then walk the
  // shuffle taking the first *unique* slug seen until `count` is reached —
  // a favorited perk's extra tickets just raise the odds one of its copies
  // lands early, they can't make it appear twice in the result.
  const weighted: Perk[] = [];
  for (const perk of pool) {
    const copies = favoriteSlugs.has(perk.slug) ? FAVORITE_WEIGHT : 1;
    for (let i = 0; i < copies; i++) weighted.push(perk);
  }

  const picked: Perk[] = [];
  const seen = new Set<string>();
  for (const perk of shuffle(weighted, random)) {
    if (seen.has(perk.slug)) continue;
    seen.add(perk.slug);
    picked.push(perk);
    if (picked.length === count) break;
  }
  return picked;
}

/** Same draw as getRandomPerks, but first guarantees up to `count` of
 *  `character`'s own teachable perks (still respecting exclusions — a
 *  teachable the player has manually excluded is never force-included),
 *  then fills any remaining slots the normal random way. `character: null`
 *  falls straight through to getRandomPerks, so callers don't need a
 *  separate branch for "no character selected." */
export function getRandomPerksWithTeachables(
  role: PerkRole,
  count: number,
  character: string | null,
  excludedSlugs?: ReadonlySet<string>,
  random: () => number = Math.random,
  favoriteSlugs?: ReadonlySet<string>,
): Perk[] {
  if (!character) return getRandomPerks(role, count, excludedSlugs, random, favoriteSlugs);

  const pool = getAvailablePool(role, excludedSlugs);
  const guaranteed = shuffle(
    pool.filter((p) => p.character === character),
    random,
  ).slice(0, count);
  const remaining = count - guaranteed.length;
  if (remaining <= 0) return guaranteed;

  const extraExcluded = new Set(excludedSlugs ?? []);
  for (const perk of guaranteed) extraExcluded.add(perk.slug);
  const rest = getRandomPerks(role, remaining, extraExcluded, random, favoriteSlugs);
  return shuffle([...guaranteed, ...rest], random);
}

/** Deterministic build for Daily Challenge / shared custom seeds. Always
 *  shuffles the *full* role pool (ignoring personal exclusions and Battle
 *  Royale progress) and slices the first `count` — that way the same seed
 *  gives every player the same build regardless of their local pool
 *  settings, and changing `count` only reveals more of the same order
 *  instead of reshuffling. */
export function getSeededPerks(role: PerkRole, count: number, seedString: string): Perk[] {
  const fullPool = getPerksByRole(role);
  const random = createSeededRandom(`${seedString}:${role}`);
  return shuffle(fullPool, random).slice(0, count);
}
