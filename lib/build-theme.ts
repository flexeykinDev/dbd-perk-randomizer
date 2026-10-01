import { getTagsForPerk, getTagsForRole, type PerkTag } from "./perk-tags";
import type { Perk, PerkRole } from "./types";

/**
 * What a build has in common, if anything.
 *
 * The coherence dial already biases a roll toward perks that share tags, but
 * the player only ever saw the result and the dial position — never the
 * reason. The reason is the interesting half: "three of these are aura
 * perks" is something you screenshot, where four perk names are just a
 * result.
 *
 * Derived from the tags the scraper already wrote into data/perks.json. No
 * new data, nothing hand-written per perk.
 *
 * ## When it says nothing
 *
 * A majority, and at least two. Both halves matter:
 *
 * The majority rule is what keeps it honest. The tags are a keyword
 * heuristic averaging 1.52 per survivor perk, so in any four-perk build
 * several tags will be present once by accident; reporting those would mean
 * the line is always on and always weak, which teaches people to stop
 * reading it. Requiring more than half the build means the theme is the
 * thing you would have noticed yourself.
 *
 * At least two is implied by the majority of any build of three or more, but
 * stated so a one or two perk roll cannot report a "theme" of one perk.
 *
 * The consequence, deliberately: at coherence 0 the roll is a plain shuffle
 * and most builds say nothing at all. That is the honest outcome — a line
 * that appeared under a genuinely unrelated build would be the site inventing
 * a story about four random perks.
 */
export interface BuildTheme {
  tag: PerkTag;
  /** How many perks in the build carry it. Always a majority. */
  count: number;
  total: number;
}

export function getBuildTheme(perks: readonly Perk[], role: PerkRole): BuildTheme | null {
  if (perks.length < 3) return null;

  const counts = new Map<string, number>();
  for (const perk of perks) {
    for (const tagId of getTagsForPerk(perk)) {
      counts.set(tagId, (counts.get(tagId) ?? 0) + 1);
    }
  }

  const needed = Math.floor(perks.length / 2) + 1;
  let bestId: string | null = null;
  let bestCount = 0;
  for (const [tagId, count] of counts) {
    if (count < needed || count < 2) continue;
    // Ties go to the tag listed first for the role, so the same build always
    // reports the same theme rather than whichever Map iteration won.
    if (count > bestCount) {
      bestId = tagId;
      bestCount = count;
    }
  }
  if (!bestId) return null;

  const tag = getTagsForRole(role).find((t) => t.id === bestId);
  if (!tag) return null;
  return { tag, count: bestCount, total: perks.length };
}
