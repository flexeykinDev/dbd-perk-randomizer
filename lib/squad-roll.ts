// Rolling one build for each member of a SWF team, with no perk turning up
// twice across the whole squad.
//
// This is deliberately not "call getRandomPerks four times". Four independent
// draws from the same pool overlap constantly — with 176 survivor perks and
// four builds of four, the odds of at least one perk appearing on two of the
// cards are better than even, and a squad that rolls Adrenaline twice has not
// really been given four builds. The team is one draw of players x buildSize
// perks that is then dealt out, which makes the no-duplicates promise a
// property of the algorithm rather than something to retry until it holds.
//
// Pure on purpose: it takes the pool rather than reading lib/perks.ts, so the
// caller stays responsible for exclusions, Battle Royale and role filtering
// exactly as it already is for the single-build roll, and so the tests can
// hand it a pool of four perks without touching the real data.
//
// Two things the single-build roll does that this deliberately does not:
//
// - Favourite weighting (FAVORITE_WEIGHT in lib/perks.ts). A squad has only
//   one person's favourites — whoever is at the keyboard — and weighting all
//   four hands by their taste biases three builds that belong to someone else.
// - Guaranteed teachables for a chosen character (getRandomPerksWithTeachables).
//   A squad would want a character per player, which is a bigger question than
//   the roll itself.
//
// Both were left out by decision rather than oversight. Reopen them with the
// same reasoning if the squad ever grows a per-player setup step.
import { createSeededRandom, shuffle } from "./seeded-random";
import type { Perk, PerkRole } from "./types";

/** One build per player, in player order. Each inner array is what
 *  PerkGrid already renders for a single build. */
export type Squad = Perk[][];

function clampCount(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

/** The pool with any repeated slug removed, keeping first appearance.
 *
 *  getAvailablePool never returns duplicates today, so this is insurance
 *  rather than a fix: the no-duplicates guarantee below is enforced by
 *  handing out each pool entry once, which would quietly break if the same
 *  perk were in the pool twice. Cheap to rule out, and it keeps the promise
 *  true of the *slugs* a player sees rather than of array positions. */
function uniqueBySlug(pool: readonly Perk[]): Perk[] {
  const seen = new Set<string>();
  const out: Perk[] = [];
  for (const perk of pool) {
    if (seen.has(perk.slug)) continue;
    seen.add(perk.slug);
    out.push(perk);
  }
  return out;
}

/**
 * Rolls `players` builds of up to `buildSize` perks each, no perk shared.
 *
 * When the pool cannot fill everyone — a heavily trimmed pool, or a long
 * Battle Royale run — it fills what it can rather than throwing, and the
 * shortfall is shared out instead of landing on the last players. Perks are
 * dealt round-robin from a single shuffle, so 10 perks across 4 players of 4
 * gives 3/3/2/2 and not 4/4/2/0. A squad where one player has a full build
 * and another has none is a worse answer than everyone being one perk short,
 * and dealing is also what makes the even split fall out for free rather than
 * being a second pass over the result.
 *
 * Every player always gets an array, even an empty one, so the UI can render
 * four columns without a special case for "this player got nothing".
 *
 * @param random Defaults to Math.random; pass a seeded RNG from
 * createSeededRandom for a reproducible squad, or use rollSeededSquad below.
 */
export function rollSquad(
  pool: readonly Perk[],
  buildSize: number,
  players: number,
  random: () => number = Math.random,
): Squad {
  const playerCount = clampCount(players);
  const size = clampCount(buildSize);
  const builds: Squad = Array.from({ length: playerCount }, () => []);
  if (playerCount === 0 || size === 0) return builds;

  const deck = shuffle(uniqueBySlug(pool), random);
  const wanted = Math.min(deck.length, playerCount * size);

  for (let i = 0; i < wanted; i++) {
    builds[i % playerCount].push(deck[i]);
  }
  return builds;
}

/**
 * Deterministic squad for a shared link or a Daily-style seed: the same seed
 * and the same pool always produce the same four builds.
 *
 * The seed is scoped by role the same way getSeededPerks does it, so a
 * survivor squad and a killer squad on one seed are different draws rather
 * than the same order of two different pools. Player count is folded in as
 * well: without it, rolling a squad of three and a squad of four from one
 * seed would deal the same perks into different hands, which reads as a bug
 * to anyone who tries it.
 */
export function rollSeededSquad(
  role: PerkRole,
  pool: readonly Perk[],
  buildSize: number,
  players: number,
  seedString: string,
): Squad {
  const playerCount = clampCount(players);
  return rollSquad(
    pool,
    buildSize,
    playerCount,
    createSeededRandom(`${seedString}:${role}:${playerCount}`),
  );
}

/** Every slug in a squad, flattened — for the share-link encoding in chunk 3
 *  and for asserting the no-duplicates promise in the tests. */
export function squadSlugs(squad: Squad): string[] {
  return squad.flat().map((perk) => perk.slug);
}
