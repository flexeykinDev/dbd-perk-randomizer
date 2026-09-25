// The squad roll's three promises: nobody shares a perk, a seed reproduces
// the whole team, and a pool too small to fill everyone shortens everyone
// rather than throwing or leaving a player empty-handed.
//
// Mostly run against synthetic pools, because the interesting cases are
// about pool *size* and a hand-made pool of 10 says exactly what it means.
// The last test uses the real survivor pool, since "four builds of four from
// the shipped data never collide" is the claim a player would actually make.
import { test } from "node:test";
import assert from "node:assert/strict";
import { rollSeededSquad, rollSquad, squadSlugs } from "./squad-roll";
import { getPerksByRole } from "./perks";
import { createSeededRandom } from "./seeded-random";
import type { Perk } from "./types";

/** Enough of a Perk for a roller that only ever reads `slug`. */
const perk = (slug: string) => ({ slug, role: "survivor" }) as Perk;

/** A pool of n distinct perks, named so a failure message is readable. */
const poolOf = (n: number) => Array.from({ length: n }, (_, i) => perk(`p${i + 1}`));

const sizes = (squad: Perk[][]) => squad.map((build) => build.length);

test("no perk appears twice across the squad", () => {
  // Many seeds rather than one: a collision would be probabilistic if the
  // implementation drew per player, so one lucky run must not pass this.
  for (let i = 0; i < 300; i++) {
    const squad = rollSquad(poolOf(40), 4, 4, createSeededRandom(`squad-${i}`));
    const slugs = squadSlugs(squad);
    assert.equal(
      new Set(slugs).size,
      slugs.length,
      `seed squad-${i} dealt a duplicate: ${slugs.join(", ")}`,
    );
  }
});

test("every player gets a full build when the pool is big enough", () => {
  const squad = rollSquad(poolOf(40), 4, 4, createSeededRandom("plenty"));
  assert.deepEqual(sizes(squad), [4, 4, 4, 4]);
  assert.equal(squadSlugs(squad).length, 16);
});

test("a pool too small for everyone is shared out, not spent on the first players", () => {
  // 10 perks, 4 players wanting 4 each. Dealing gives 3/3/2/2; drawing per
  // player in turn would give 4/4/2/0, which is the outcome this exists to
  // rule out.
  const squad = rollSquad(poolOf(10), 4, 4, createSeededRandom("short"));
  assert.deepEqual(sizes(squad), [3, 3, 2, 2]);
  assert.equal(squadSlugs(squad).length, 10, "every available perk should be dealt");
  assert.equal(new Set(squadSlugs(squad)).size, 10);
});

test("a pool smaller than the player count still gives everyone an array", () => {
  const squad = rollSquad(poolOf(2), 4, 4, createSeededRandom("tiny"));
  assert.equal(squad.length, 4, "a player with no perks still needs a column");
  assert.deepEqual(sizes(squad), [1, 1, 0, 0]);
});

test("an empty pool returns one empty build per player rather than throwing", () => {
  const squad = rollSquad([], 4, 4, createSeededRandom("none"));
  assert.deepEqual(sizes(squad), [0, 0, 0, 0]);
});

test("zero players and zero build size are answered, not thrown at", () => {
  assert.deepEqual(rollSquad(poolOf(40), 4, 0, createSeededRandom("x")), []);
  assert.deepEqual(sizes(rollSquad(poolOf(40), 0, 4, createSeededRandom("x"))), [0, 0, 0, 0]);
});

test("nonsense counts are clamped instead of producing a ragged squad", () => {
  assert.deepEqual(rollSquad(poolOf(40), 4, -2, createSeededRandom("x")), []);
  assert.deepEqual(sizes(rollSquad(poolOf(40), 2.7, 3, createSeededRandom("x"))), [2, 2, 2]);
  assert.deepEqual(rollSquad(poolOf(40), 4, Number.NaN, createSeededRandom("x")), []);
});

test("a repeated perk in the pool cannot be dealt to two players", () => {
  const duped = [...poolOf(6), perk("p1"), perk("p2")];
  const squad = rollSquad(duped, 2, 4, createSeededRandom("dupe-pool"));
  const slugs = squadSlugs(squad);
  assert.equal(new Set(slugs).size, slugs.length);
});

test("the same seed reproduces the whole squad, player by player", () => {
  const pool = poolOf(40);
  const a = rollSeededSquad("survivor", pool, 4, 4, "share-me");
  const b = rollSeededSquad("survivor", pool, 4, 4, "share-me");
  assert.deepEqual(squadSlugs(a), squadSlugs(b));
  // Per player, not just as a set: a link that reopens the right sixteen
  // perks in the wrong hands has not reopened the build anyone shared.
  assert.deepEqual(
    a.map((build) => build.map((p) => p.slug)),
    b.map((build) => build.map((p) => p.slug)),
  );
});

test("a different seed, role or player count is a different deal", () => {
  const pool = poolOf(40);
  const base = squadSlugs(rollSeededSquad("survivor", pool, 4, 4, "seed-a"));
  assert.notDeepEqual(base, squadSlugs(rollSeededSquad("survivor", pool, 4, 4, "seed-b")));
  assert.notDeepEqual(base, squadSlugs(rollSeededSquad("killer", pool, 4, 4, "seed-a")));
  // Three players on one seed must not simply be the four-player deal with
  // a hand lopped off — that would look like the squad silently reshuffling.
  assert.notDeepEqual(
    squadSlugs(rollSeededSquad("survivor", pool, 4, 3, "seed-a")).slice(0, 9),
    base.slice(0, 9),
  );
});

test("four builds of four from the real survivor pool never collide", () => {
  const pool = getPerksByRole("survivor");
  assert.ok(pool.length >= 16, "the shipped pool should be able to fill a squad");
  for (let i = 0; i < 200; i++) {
    const slugs = squadSlugs(rollSquad(pool, 4, 4, createSeededRandom(`real-${i}`)));
    assert.equal(slugs.length, 16);
    assert.equal(new Set(slugs).size, 16, `seed real-${i} collided`);
  }
});
