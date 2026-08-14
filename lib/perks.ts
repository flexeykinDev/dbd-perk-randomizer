import perksData from "@/data/perks.json";
import metaData from "@/data/meta.json";
import charactersData from "@/data/characters.json";
import type { Perk, PerkRole, PerksMeta } from "./types";

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

function shuffle<T>(items: T[]): T[] {
  const shuffled = [...items];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
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
): Perk[] {
  const fullPool = getPerksByRole(role);
  const pool = getAvailablePool(role, excludedSlugs);
  // If exclusions leave too few perks to fill a build, fall back to the
  // full pool rather than showing a broken/short grid. Callers that need to
  // know when the pool is truly exhausted (e.g. Battle Royale mode) should
  // check getAvailablePool().length themselves before calling this.
  const source = pool.length >= count ? pool : fullPool;
  return shuffle(source).slice(0, count);
}
