import perksData from "@/data/perks.json";
import metaData from "@/data/meta.json";
import charactersData from "@/data/characters.json";
import type { Perk, PerkRole, PerksMeta } from "./types";
import { createSeededRandom } from "./seeded-random";

export const perks: Perk[] = perksData as Perk[];
export const perksMeta: PerksMeta = metaData as PerksMeta;
const characterPortraits: Record<string, string> = charactersData;

export function getCharacterPortrait(character: string): string | undefined {
  return characterPortraits[character];
}

const perksBySlug = new Map(perks.map((perk) => [perk.slug, perk]));

const NEW_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export function getPerksByRole(role: PerkRole): Perk[] {
  return perks.filter((perk) => perk.role === role);
}

export function getPerkBySlug(slug: string): Perk | undefined {
  return perksBySlug.get(slug);
}

export function isNewPerk(perk: Perk): boolean {
  return Date.now() - new Date(perk.addedAt).getTime() < NEW_WINDOW_MS;
}

/** @param random Defaults to Math.random; pass a seeded RNG (see
 *  lib/seeded-random.ts) for deterministic shuffling, e.g. Daily Challenge. */
function shuffle<T>(items: T[], random: () => number = Math.random): T[] {
  const shuffled = [...items];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export function getAvailablePool(
  role: PerkRole,
  excludedSlugs?: ReadonlySet<string>,
): Perk[] {
  const fullPool = getPerksByRole(role);
  if (!excludedSlugs || excludedSlugs.size === 0) return fullPool;
  return fullPool.filter((perk) => !excludedSlugs.has(perk.slug));
}

export function getRandomPerks(
  role: PerkRole,
  count: number,
  excludedSlugs?: ReadonlySet<string>,
  random: () => number = Math.random,
): Perk[] {
  // Never pull from outside the caller's excluded-respecting pool, even when
  // it's smaller than `count` — silently topping up from excluded perks
  // would defeat the entire point of excluding them. Callers should check
  // getAvailablePool().length themselves beforehand (see randomizer-board.tsx's
  // `poolExhausted`) and show an explicit "not enough perks" state instead of
  // calling this with a pool too small to fill the request.
  const pool = getAvailablePool(role, excludedSlugs);
  return shuffle(pool, random).slice(0, count);
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
