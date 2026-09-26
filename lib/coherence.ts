// How much the roll should try to hand you a build that hangs together.
//
// The board already filters the pool by a single theme tag, which answers a
// different question: it narrows what can appear at all, so a "Healing" roll
// can only ever be healing perks and the other 131 survivor perks stop
// existing. This weights instead of filtering — every perk stays reachable at
// every level, some are just likelier once the build has started leaning one
// way.
//
// The tags are the ones the scraper already wrote into data/perks.json (see
// classifyPerk in lib/perk-tags.ts). They are a keyword heuristic, not curated
// data, and two facts about them shape everything below:
//
//   survivor  176 perks, 17 untagged, 1.52 tags each on average
//   killer    145 perks, 34 untagged, 1.14 tags each on average
//
// So roughly a quarter of killer perks carry no tag at all and can never
// "share" anything. They must stay rollable — a coherence dial that quietly
// deleted 34 perks from the killer pool would be the theme filter again,
// wearing a different name. Hence the weight floor below.
//
// Pure, and seeded through the caller's `random` exactly like every other
// roll here, so a seed plus a level reproduces a build for everyone.
import { shuffle } from "./seeded-random";
import type { Perk } from "./types";

/** 0 is today's roll, untouched. 3 leans hard. */
export type CoherenceLevel = 0 | 1 | 2 | 3;

export const COHERENCE_LEVELS: readonly CoherenceLevel[] = [0, 1, 2, 3];

export const DEFAULT_COHERENCE: CoherenceLevel = 0;

/** How hard each level pulls. A candidate's weight is
 *  `1 + STRENGTH[level] * overlap`, so at level 0 every weight is 1 and the
 *  draw is uniform — which is what keeps "chaos" genuinely identical to the
 *  roll this site has always done, rather than merely similar to it.
 *
 *  The top of the scale is 5 because past it the dial stops buying much and
 *  starts costing something. Measured over 2,000 four-perk rolls per setting,
 *  as mean pairs-sharing-a-tag (see buildCohesion), and as how many untagged
 *  perks still reach a build:
 *
 *              survivor            killer
 *    strength  cohesion untagged   cohesion untagged
 *       0        1.91     0.39       1.79     0.90
 *       5        3.97     0.17       3.77     0.48
 *      10        4.24     0.18       4.21     0.38
 *      25        4.67     0.13       4.39     0.37
 *
 *  0 to 5 roughly doubles cohesion. 5 to 25 — five times the pull — adds
 *  another 0.7, while the untagged perks keep being squeezed out: a killer
 *  build naturally carries 0.90 of them and only 0.37 by strength 25. Those
 *  34 perks have no way to earn weight, so every increase is paid for by
 *  them. Five is where the curve flattens and they are still showing up.
 *
 *  Aura dominance turned out not to be the limiting factor, which is what I
 *  first assumed: builds with three or more aura perks go from 16.2% of
 *  survivor rolls at strength 0 to 40.1% at 5 and only 44.4% at 25. */
const STRENGTH: Record<CoherenceLevel, number> = { 0: 0, 1: 1, 2: 2.5, 3: 5 };

export function isCoherenceLevel(value: unknown): value is CoherenceLevel {
  return value === 0 || value === 1 || value === 2 || value === 3;
}

/** How much a candidate reinforces what has already been picked.
 *
 *  Counts every *perk* already in the build that carries each of the
 *  candidate's tags, rather than counting distinct shared tags. Two perks
 *  already leaning on Generators should pull a third generator perk harder
 *  than one did, and that is the difference between a build with a theme and
 *  a build with a coincidence in it. */
export function overlapScore(candidate: Perk, picked: readonly Perk[]): number {
  const tags = candidate.tags;
  if (!tags || tags.length === 0 || picked.length === 0) return 0;
  let score = 0;
  for (const tag of tags) {
    for (const already of picked) {
      if (already.tags?.includes(tag)) score++;
    }
  }
  return score;
}

/**
 * Picks `count` distinct perks, weighted toward what the build already is.
 *
 * At level 0 this is `shuffle(pool).slice(0, count)` — the exact call
 * getRandomPerks makes — so the untouched setting is not a re-implementation
 * of the old behaviour that happens to agree with it. It IS the old
 * behaviour, and the test that proves it compares builds, not distributions.
 *
 * Above 0: the first perk is drawn uniformly, because there is nothing yet
 * for it to cohere with and seeding a build from its commonest tag would
 * make every strong roll look the same. Each later slot is a weighted draw
 * over what is left.
 *
 * Never returns a perk twice, and never returns more than the pool holds.
 *
 * @param random Defaults to Math.random; pass a seeded RNG for a
 * reproducible build.
 * @param baseWeight A multiplier applied to every candidate before the
 * coherence bonus — how favourites stay favourites once this is switched on.
 * Taken as a function rather than a set of slugs so this module never has to
 * know what a favourite is, and so lib/perks.ts can own FAVORITE_WEIGHT
 * without the two importing each other.
 */
export function pickCoherentPerks(
  pool: readonly Perk[],
  count: number,
  level: CoherenceLevel,
  random: () => number = Math.random,
  baseWeight: (perk: Perk) => number = () => 1,
): Perk[] {
  const wanted = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  if (wanted === 0 || pool.length === 0) return [];

  const strength = STRENGTH[level] ?? 0;
  if (strength === 0) return shuffle([...pool], random).slice(0, wanted);

  const remaining = [...pool];
  const picked: Perk[] = [];
  const take = Math.min(wanted, remaining.length);

  while (picked.length < take) {
    let index: number;
    if (picked.length === 0) {
      index = Math.floor(random() * remaining.length);
    } else {
      /* Weighted draw without replacement: build the running total, take one
         number in [0, total) and walk to it. One call to random() per slot,
         which is what keeps a seed reproducible — a rejection loop would
         consume a variable number of draws and the same seed would stop
         giving the same build. */
      let total = 0;
      const cumulative: number[] = new Array(remaining.length);
      for (let i = 0; i < remaining.length; i++) {
        /* The floor of 1 is what keeps an untagged perk — a quarter of the
           killer pool — reachable at every level. The two weightings
           multiply: a favourited perk is four times likelier than it would
           otherwise be, whether or not it also happens to fit the build. */
        total +=
          baseWeight(remaining[i]) * (1 + strength * overlapScore(remaining[i], picked));
        cumulative[i] = total;
      }
      const target = random() * total;
      index = cumulative.findIndex((c) => target < c);
      // Only reachable through floating-point drift at the very top of the
      // range; falling back to the last entry is nearer than throwing.
      if (index === -1) index = remaining.length - 1;
    }

    picked.push(remaining[index]);
    // Swap-and-pop rather than splice: the order of `remaining` never
    // reaches the caller, and this keeps each slot linear in the pool.
    remaining[index] = remaining[remaining.length - 1];
    remaining.pop();
  }

  return picked;
}

/** How connected a finished build is: the number of perk pairs sharing at
 *  least one tag, out of every possible pair.
 *
 *  Exists for the tests, and is the only honest way to say the dial works —
 *  "feels more coherent" is not a measurement. Also useful if the UI ever
 *  wants to show what a roll actually produced. */
export function buildCohesion(build: readonly Perk[]): number {
  let pairs = 0;
  for (let i = 0; i < build.length; i++) {
    for (let j = i + 1; j < build.length; j++) {
      const a = build[i].tags ?? [];
      const b = build[j].tags ?? [];
      if (a.some((tag) => b.includes(tag))) pairs++;
    }
  }
  return pairs;
}
