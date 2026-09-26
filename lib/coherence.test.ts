// The coherence dial, measured rather than described.
//
// Three claims have to hold or the setting is a lie: level 0 is the roll this
// site has always done, the top level demonstrably produces builds that hang
// together more often, and a seed still reproduces a build at every level.
//
// Run against the real shipped pool, because the thing being tested is how a
// weighting behaves over a real tag distribution — one where `aura` covers 69
// of 176 survivor perks and 34 of 145 killer perks carry no tag at all. A
// synthetic pool with tidy tags would pass happily and say nothing about what
// a player actually gets.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildCohesion,
  COHERENCE_LEVELS,
  isCoherenceLevel,
  overlapScore,
  pickCoherentPerks,
  type CoherenceLevel,
} from "./coherence";
import { getPerksByRole } from "./perks";
import { createSeededRandom, shuffle } from "./seeded-random";
import type { Perk, PerkRole } from "./types";

const ROLLS = 500;
const BUILD = 4;

const slugs = (build: Perk[]) => build.map((p) => p.slug);

/** Mean pairs-sharing-a-tag across many seeded rolls at one level. */
function meanCohesion(role: PerkRole, level: CoherenceLevel): number {
  const pool = getPerksByRole(role);
  let total = 0;
  for (let i = 0; i < ROLLS; i++) {
    total += buildCohesion(
      pickCoherentPerks(pool, BUILD, level, createSeededRandom(`coh-${role}-${level}-${i}`)),
    );
  }
  return total / ROLLS;
}

test("level 0 is the existing roll, build for build", () => {
  // Not "statistically similar" — identical. getRandomPerks with no
  // favourites is shuffle(pool).slice(0, count), and level 0 has to be that
  // same call or the untouched setting has quietly changed what everyone
  // already gets from a given seed.
  const pool = getPerksByRole("survivor");
  for (let i = 0; i < 100; i++) {
    const seed = `unchanged-${i}`;
    const expected = shuffle([...pool], createSeededRandom(seed)).slice(0, BUILD);
    const actual = pickCoherentPerks(pool, BUILD, 0, createSeededRandom(seed));
    assert.deepEqual(slugs(actual), slugs(expected), `seed ${seed} diverged from today's roll`);
  }
});

test("the top level measurably raises how much a build hangs together", () => {
  for (const role of ["survivor", "killer"] as const) {
    const chaos = meanCohesion(role, 0);
    const synergy = meanCohesion(role, 3);
    assert.ok(
      synergy > chaos * 1.4,
      `${role}: level 3 cohesion ${synergy.toFixed(2)} should clearly beat level 0's ${chaos.toFixed(2)}`,
    );
  }
});

test("each step up leans further than the one below it", () => {
  // Weakly monotonic rather than strictly: these are means over random
  // draws, and levels 1 and 2 are deliberately close together.
  for (const role of ["survivor", "killer"] as const) {
    const means = COHERENCE_LEVELS.map((l) => meanCohesion(role, l));
    for (let i = 1; i < means.length; i++) {
      assert.ok(
        means[i] >= means[i - 1],
        `${role}: level ${i} (${means[i].toFixed(2)}) fell below level ${i - 1} (${means[i - 1].toFixed(2)})`,
      );
    }
  }
});

test("a seed reproduces the build at every level", () => {
  const pool = getPerksByRole("survivor");
  for (const level of COHERENCE_LEVELS) {
    const a = pickCoherentPerks(pool, BUILD, level, createSeededRandom("share-me"));
    const b = pickCoherentPerks(pool, BUILD, level, createSeededRandom("share-me"));
    assert.deepEqual(slugs(a), slugs(b), `level ${level} is not reproducible`);
  }
});

test("the level is part of what a seed means", () => {
  // Two people on one seed but different levels should not expect the same
  // build — which is exactly why the level has to travel with a share link
  // if it is ever put in one.
  const pool = getPerksByRole("survivor");
  const chaos = pickCoherentPerks(pool, BUILD, 0, createSeededRandom("same-seed"));
  const synergy = pickCoherentPerks(pool, BUILD, 3, createSeededRandom("same-seed"));
  assert.notDeepEqual(slugs(chaos), slugs(synergy));
});

test("no perk is ever drawn twice", () => {
  for (const level of COHERENCE_LEVELS) {
    for (const role of ["survivor", "killer"] as const) {
      const pool = getPerksByRole(role);
      for (let i = 0; i < 200; i++) {
        const build = pickCoherentPerks(pool, BUILD, level, createSeededRandom(`dupe-${level}-${i}`));
        assert.equal(build.length, BUILD);
        assert.equal(new Set(slugs(build)).size, BUILD, `level ${level} seed ${i} repeated a perk`);
      }
    }
  }
});

test("an untagged perk stays reachable at the strongest setting", () => {
  /* A quarter of the killer pool carries no tag and can never share one. If
   * the weighting ever reaches zero for them they are silently deleted from
   * the pool — the failure this whole design is arranged to avoid. */
  const pool = getPerksByRole("killer");
  const untagged = new Set(pool.filter((p) => !p.tags || p.tags.length === 0).map((p) => p.slug));
  assert.ok(untagged.size > 0, "the fixture assumption is that some perks have no tags");

  let seen = 0;
  for (let i = 0; i < 400; i++) {
    const build = pickCoherentPerks(pool, BUILD, 3, createSeededRandom(`reach-${i}`));
    if (build.some((p) => untagged.has(p.slug))) seen++;
  }
  assert.ok(seen > 0, "untagged killer perks never came up in 400 max-coherence rolls");
});

test("every perk in the pool can still come up at the strongest setting", () => {
  // Stronger than the test above: not just "untagged perks appear" but "the
  // pool is not effectively narrowed". Over enough rolls most of it should
  // show up; the bar is deliberately loose because 500 rolls of 4 is 2,000
  // draws over 176 perks.
  const pool = getPerksByRole("survivor");
  const seen = new Set<string>();
  for (let i = 0; i < 500; i++) {
    for (const perk of pickCoherentPerks(pool, BUILD, 3, createSeededRandom(`spread-${i}`))) {
      seen.add(perk.slug);
    }
  }
  assert.ok(
    seen.size > pool.length * 0.9,
    `only ${seen.size} of ${pool.length} perks ever appeared at level 3`,
  );
});

test("overlapScore counts perks, not distinct tags", () => {
  const perk = (slug: string, tags: string[]) => ({ slug, tags, role: "survivor" }) as Perk;
  const candidate = perk("c", ["aura", "healing"]);

  assert.equal(overlapScore(candidate, []), 0);
  assert.equal(overlapScore(candidate, [perk("a", ["stealth"])]), 0);
  assert.equal(overlapScore(candidate, [perk("a", ["aura"])]), 1);
  // Two perks already carrying aura pull twice as hard as one.
  assert.equal(overlapScore(candidate, [perk("a", ["aura"]), perk("b", ["aura"])]), 2);
  // Both of the candidate's tags count.
  assert.equal(overlapScore(candidate, [perk("a", ["aura", "healing"])]), 2);
  assert.equal(overlapScore(perk("x", []), [perk("a", ["aura"])]), 0);
});

test("buildCohesion counts the pairs that share something", () => {
  const perk = (slug: string, tags: string[]) => ({ slug, tags, role: "survivor" }) as Perk;
  assert.equal(buildCohesion([]), 0);
  assert.equal(buildCohesion([perk("a", ["aura"])]), 0);
  assert.equal(buildCohesion([perk("a", ["aura"]), perk("b", ["aura"])]), 1);
  assert.equal(buildCohesion([perk("a", ["aura"]), perk("b", ["stealth"])]), 0);
  assert.equal(
    buildCohesion([perk("a", ["aura"]), perk("b", ["aura"]), perk("c", ["aura"])]),
    3,
    "three mutually-sharing perks are three pairs",
  );
  assert.equal(buildCohesion([perk("a", []), perk("b", [])]), 0);
});

test("degenerate inputs are answered rather than thrown at", () => {
  const pool = getPerksByRole("survivor");
  for (const level of COHERENCE_LEVELS) {
    assert.deepEqual(pickCoherentPerks(pool, 0, level, createSeededRandom("x")), []);
    assert.deepEqual(pickCoherentPerks([], 4, level, createSeededRandom("x")), []);
    assert.deepEqual(pickCoherentPerks(pool, -3, level, createSeededRandom("x")), []);
    assert.deepEqual(pickCoherentPerks(pool, Number.NaN, level, createSeededRandom("x")), []);
    // A pool smaller than the build gives back everything it has, once.
    const tiny = pool.slice(0, 2);
    const build = pickCoherentPerks(tiny, 4, level, createSeededRandom("x"));
    assert.equal(build.length, 2);
    assert.equal(new Set(slugs(build)).size, 2);
  }
});

test("isCoherenceLevel rejects anything a stored value could turn out to be", () => {
  for (const level of COHERENCE_LEVELS) assert.ok(isCoherenceLevel(level));
  for (const bad of [-1, 4, 1.5, "2", null, undefined, {}, [], Number.NaN]) {
    assert.equal(isCoherenceLevel(bad), false, `${String(bad)} should not pass`);
  }
});

test("favourites still count once coherence is on", () => {
  /* Turning this dial on must not quietly disable the other weighting the
   * site already has. A favourited perk is four times likelier either way;
   * with coherence it is four times likelier than whatever the coherence
   * bonus already made it. */
  const pool = getPerksByRole("survivor");
  const favourite = pool[7].slug;
  const favourites = new Set([favourite]);
  const weight = (perk: Perk) => (favourites.has(perk.slug) ? 4 : 1);

  let withFav = 0;
  let without = 0;
  for (let i = 0; i < 600; i++) {
    const seed = createSeededRandom(`fav-${i}`);
    if (pickCoherentPerks(pool, BUILD, 3, seed, weight).some((p) => p.slug === favourite)) withFav++;
    if (pickCoherentPerks(pool, BUILD, 3, createSeededRandom(`fav-${i}`)).some((p) => p.slug === favourite))
      without++;
  }
  assert.ok(
    withFav > without * 1.5,
    `a favourite should come up much more often: ${withFav} vs ${without} in 600 rolls`,
  );
});

test("a base weight cannot make a perk unreachable", () => {
  // Weight 0 would delete a perk from the pool rather than disfavour it, and
  // nothing in the app asks for that — but the draw must not break if some
  // future caller does.
  const pool = getPerksByRole("survivor").slice(0, 10);
  const build = pickCoherentPerks(pool, 4, 3, createSeededRandom("zeros"), () => 0);
  assert.equal(build.length, 4);
  assert.equal(new Set(slugs(build)).size, 4);
});
