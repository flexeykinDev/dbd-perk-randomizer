// "Give me something I have never had."
//
// The Stats modal already answers how much of the pool has come up — the
// coverage bar, from getRoleStatsSummary. What it could not do is anything
// about it: a player 184 perks into 321 has no way to go looking for the
// other 137 except by rolling and hoping, which gets slower exactly as it
// gets more interesting.
//
// Pure, and given the pool and the seen set rather than reading either, for
// the same reason the rest of lib/ is: the caller already owns exclusions,
// role filtering and storage, and the tests can hand this a pool of three.
import { shuffle } from "./seeded-random";
import type { Perk } from "./types";

/** What the roll could actually do, which is not always what was asked. */
export type UnseenOutcome =
  /** Every slot filled from perks that have never come up. */
  | "fresh"
  /** Some unseen left, but fewer than the build needs; the rest is ordinary. */
  | "topped-up"
  /** Nothing left unseen. An ordinary roll, and worth saying so. */
  | "exhausted";

export interface UnseenRoll {
  perks: Perk[];
  outcome: UnseenOutcome;
  /** How many unseen perks there were before this roll — what the message
   *  to the player is phrased around. */
  unseenCount: number;
}

/** The pool members that have never been rolled, in pool order. */
export function getUnseenPerks(
  pool: readonly Perk[],
  seenSlugs: ReadonlySet<string>,
): Perk[] {
  return pool.filter((perk) => !seenSlugs.has(perk.slug));
}

/**
 * Rolls a build from perks that have never come up, and says honestly what
 * it managed.
 *
 * The three outcomes are the whole point. A button that silently returns an
 * ordinary build once the pool is exhausted looks identical to one that is
 * broken, and a build quietly topped up with old perks is the same problem
 * in miniature. The caller gets the outcome and tells the player.
 *
 * Topping up is deliberate rather than returning a short build: with two
 * unseen perks left and a four-perk build, two perks and two empty slots is
 * not a build. The unseen ones are all included and the rest fills in around
 * them, then the whole thing is shuffled so the new perks are not always in
 * the first slots — the same shape getRandomPerksWithTeachables uses for
 * guaranteed teachables.
 *
 * @param random Defaults to Math.random; pass a seeded RNG for a
 * reproducible result.
 */
export function rollUnseenPerks(
  pool: readonly Perk[],
  seenSlugs: ReadonlySet<string>,
  count: number,
  random: () => number = Math.random,
): UnseenRoll {
  const wanted = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  const unseen = getUnseenPerks(pool, seenSlugs);

  if (wanted === 0) {
    return { perks: [], outcome: unseen.length > 0 ? "fresh" : "exhausted", unseenCount: unseen.length };
  }

  if (unseen.length === 0) {
    // Nothing new to offer. Still give back a build rather than nothing —
    // the player pressed a roll button — and let the caller say why it is
    // an ordinary one.
    return {
      perks: shuffle([...pool], random).slice(0, wanted),
      outcome: "exhausted",
      unseenCount: 0,
    };
  }

  if (unseen.length >= wanted) {
    return {
      perks: shuffle(unseen, random).slice(0, wanted),
      outcome: "fresh",
      unseenCount: unseen.length,
    };
  }

  const seenPool = pool.filter((perk) => seenSlugs.has(perk.slug));
  const filler = shuffle(seenPool, random).slice(0, wanted - unseen.length);
  return {
    perks: shuffle([...unseen, ...filler], random),
    outcome: "topped-up",
    unseenCount: unseen.length,
  };
}
