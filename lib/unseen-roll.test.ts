// Rolling from what you have never been given.
//
// The interesting cases are all at the edges: the pool just about to run
// out, the pool that already has, and the player who has rolled nothing at
// all. The middle — "plenty left, draw four" — is the easy one and the
// least likely to break.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { getUnseenPerks, rollUnseenPerks } from "./unseen-roll";
import { getSeenSlugs, recordRoll, resetStats } from "./stats";
import { getPerksByRole } from "./perks";
import { createSeededRandom } from "./seeded-random";
import type { Perk } from "./types";

const perk = (slug: string) => ({ slug, role: "survivor" }) as Perk;
const poolOf = (n: number) => Array.from({ length: n }, (_, i) => perk(`p${i + 1}`));
const slugs = (perks: Perk[]) => perks.map((p) => p.slug);
const seen = (...s: string[]) => new Set(s);

beforeEach(() => {
  localStorage.clear();
});

test("with plenty unseen, every perk in the build is one you have not had", () => {
  const pool = poolOf(20);
  const already = seen("p1", "p2", "p3");
  const roll = rollUnseenPerks(pool, already, 4, createSeededRandom("plenty"));

  assert.equal(roll.outcome, "fresh");
  assert.equal(roll.perks.length, 4);
  assert.equal(roll.unseenCount, 17);
  for (const p of roll.perks) assert.ok(!already.has(p.slug), `${p.slug} had already come up`);
});

test("exactly enough unseen still counts as a fresh build", () => {
  // The boundary: four left, four wanted. An off-by-one here would top up
  // a build that did not need it and tell the player the wrong thing.
  const pool = poolOf(10);
  const already = seen("p1", "p2", "p3", "p4", "p5", "p6");
  const roll = rollUnseenPerks(pool, already, 4, createSeededRandom("exact"));

  assert.equal(roll.outcome, "fresh");
  assert.deepEqual(slugs(roll.perks).sort(), ["p10", "p7", "p8", "p9"]);
});

test("fewer unseen than the build needs: all of them, topped up, and said so", () => {
  const pool = poolOf(10);
  const already = seen("p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8");
  const roll = rollUnseenPerks(pool, already, 4, createSeededRandom("short"));

  assert.equal(roll.outcome, "topped-up");
  assert.equal(roll.unseenCount, 2);
  assert.equal(roll.perks.length, 4, "a short build is not a build");
  // Both unseen perks must be in it — they are the reason the button exists.
  assert.ok(slugs(roll.perks).includes("p9"));
  assert.ok(slugs(roll.perks).includes("p10"));
  assert.equal(new Set(slugs(roll.perks)).size, 4, "no perk twice");
});

test("one unseen perk left is still worth a build", () => {
  const pool = poolOf(6);
  const already = seen("p1", "p2", "p3", "p4", "p5");
  const roll = rollUnseenPerks(pool, already, 4, createSeededRandom("one"));

  assert.equal(roll.outcome, "topped-up");
  assert.equal(roll.unseenCount, 1);
  assert.ok(slugs(roll.perks).includes("p6"));
  assert.equal(roll.perks.length, 4);
});

test("nothing left unseen gives an ordinary build and admits it", () => {
  const pool = poolOf(8);
  const already = seen(...pool.map((p) => p.slug));
  const roll = rollUnseenPerks(pool, already, 4, createSeededRandom("done"));

  assert.equal(roll.outcome, "exhausted");
  assert.equal(roll.unseenCount, 0);
  assert.equal(roll.perks.length, 4, "the player pressed a roll button; give them a roll");
  assert.equal(new Set(slugs(roll.perks)).size, 4);
});

test("a player who has rolled nothing gets an all-new build, not an empty one", () => {
  // The first-visit case. Everything is unseen, which is the happiest
  // possible version of this feature and must not be mistaken for the
  // exhausted one.
  const pool = poolOf(20);
  const roll = rollUnseenPerks(pool, new Set(), 4, createSeededRandom("first"));

  assert.equal(roll.outcome, "fresh");
  assert.equal(roll.unseenCount, 20);
  assert.equal(roll.perks.length, 4);
});

test("an empty pool is answered rather than thrown at", () => {
  const roll = rollUnseenPerks([], new Set(), 4, createSeededRandom("none"));
  assert.deepEqual(roll.perks, []);
  assert.equal(roll.outcome, "exhausted");
  assert.equal(roll.unseenCount, 0);
});

test("degenerate counts are answered too", () => {
  const pool = poolOf(10);
  for (const count of [0, -2, Number.NaN]) {
    const roll = rollUnseenPerks(pool, new Set(), count, createSeededRandom("x"));
    assert.deepEqual(roll.perks, [], `count ${count}`);
  }
});

test("a pool smaller than the build gives back everything it has, once", () => {
  const pool = poolOf(2);
  const roll = rollUnseenPerks(pool, new Set(), 4, createSeededRandom("tiny"));
  assert.equal(roll.perks.length, 2);
  assert.equal(new Set(slugs(roll.perks)).size, 2);
});

test("the same seed reproduces the build", () => {
  const pool = poolOf(30);
  const already = seen("p1", "p2");
  const a = rollUnseenPerks(pool, already, 4, createSeededRandom("repeat"));
  const b = rollUnseenPerks(pool, already, 4, createSeededRandom("repeat"));
  assert.deepEqual(slugs(a.perks), slugs(b.perks));
});

test("getUnseenPerks is the set difference, in pool order", () => {
  const pool = poolOf(5);
  assert.deepEqual(slugs(getUnseenPerks(pool, seen("p2", "p4"))), ["p1", "p3", "p5"]);
  assert.deepEqual(slugs(getUnseenPerks(pool, new Set())), ["p1", "p2", "p3", "p4", "p5"]);
  assert.deepEqual(getUnseenPerks(pool, seen(...pool.map((p) => p.slug))), []);
  // A slug that is not in the pool at all — a retired perk still in someone's
  // saved tally — changes nothing.
  assert.deepEqual(slugs(getUnseenPerks(pool, seen("gone"))), ["p1", "p2", "p3", "p4", "p5"]);
});

test("it reads the tally the app actually writes", () => {
  /* End to end against lib/stats.ts rather than a hand-made Set, because the
   * two have to agree about what "seen" means. recordRoll is what the board
   * calls after every generate. */
  resetStats();
  const pool = getPerksByRole("survivor");
  const rolled = pool.slice(0, 4);
  recordRoll("survivor", rolled);

  const seenSlugs = getSeenSlugs("survivor");
  assert.deepEqual([...seenSlugs].sort(), slugs(rolled).sort());

  const roll = rollUnseenPerks(pool, seenSlugs, 4, createSeededRandom("wired"));
  assert.equal(roll.outcome, "fresh");
  assert.equal(roll.unseenCount, pool.length - 4);
  for (const p of roll.perks) {
    assert.ok(!seenSlugs.has(p.slug), `${p.slug} was just rolled and should not be "unseen"`);
  }
});

test("killer and survivor are counted apart", () => {
  resetStats();
  recordRoll("survivor", getPerksByRole("survivor").slice(0, 4));
  assert.equal(getSeenSlugs("survivor").size, 4);
  assert.equal(getSeenSlugs("killer").size, 0, "rolling as survivor says nothing about killer");
});

test("a stored count of zero reads as unseen", () => {
  // Should not occur, but a hand-edited or older-version payload could carry
  // one, and "rolled zero times" is exactly what this feature means by new.
  localStorage.setItem(
    "dbd-randomizer:stats",
    JSON.stringify({ survivor: { totalBuilds: 1, rolls: { adrenaline: 0, resilience: 2 } }, killer: { totalBuilds: 0, rolls: {} } }),
  );
  const seenSlugs = getSeenSlugs("survivor");
  assert.ok(!seenSlugs.has("adrenaline"));
  assert.ok(seenSlugs.has("resilience"));
});
