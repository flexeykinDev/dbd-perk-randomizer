// The decision-making inside the board's extracted hooks, tested directly.
//
// The hooks themselves need a React renderer this project does not have (no
// jsdom, no testing-library — the strategy here is pure-logic unit tests plus
// a browser suite that runs against the real static export). So the parts that
// actually DECIDE something are plain functions, and this covers them at a
// level the e2e suite cannot reach cheaply: every combination, not the handful
// a session happens to walk through.
//
// Everything else in those hooks is useState and useMemo wiring, which the
// browser suite exercises for real.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeExclusions } from "./use-exclusions";
import { seedModeForLink } from "./use-seed";
import { dailyChallengeSeed } from "./seeded-random";

/* ---------------------------------------------------------------- */
/* mergeExclusions                                                    */
/* ---------------------------------------------------------------- */

test("nothing else applying returns the saved set ITSELF, not a copy", () => {
  /* Identity, not contents. The merged set is a useMemo dependency further
     down: handing back a fresh Set every render would change identity on
     every render and re-roll the build for no reason. */
  const saved = new Set(["a", "b"]);
  assert.equal(mergeExclusions(saved, []), saved);
  assert.equal(mergeExclusions(saved, [null, undefined]), saved);
  assert.equal(
    mergeExclusions(saved, [new Set()]),
    saved,
    "an empty extra set is the same as no extra set",
  );
});

test("every extra set is folded in, not just the first", () => {
  // The theme filter used to sit second in this list. A merge that stopped
  // after the first extra would drop it and roll from the whole pool, which
  // is invisible without counting.
  const merged = mergeExclusions(new Set(["saved"]), [
    new Set(["battle-royale"]),
    new Set(["theme"]),
  ]);
  assert.deepEqual([...merged].sort(), ["battle-royale", "saved", "theme"]);
});

test("the saved set is never mutated", () => {
  // It is React state; mutating it in place would leave the UI showing a
  // stale count and skip the re-render that should follow.
  const saved = new Set(["keep"]);
  mergeExclusions(saved, [new Set(["other"])]);
  assert.deepEqual([...saved], ["keep"]);
});

test("overlapping sets collapse rather than duplicating", () => {
  const merged = mergeExclusions(new Set(["shared"]), [
    new Set(["shared", "extra"]),
  ]);
  assert.equal(merged.size, 2);
});

test("an empty saved set still picks up the extras", () => {
  // The common case on a first visit with a theme selected: nothing has been
  // ruled out by hand, but the theme still has to narrow the roll.
  const merged = mergeExclusions(new Set(), [new Set(["theme-a", "theme-b"])]);
  assert.deepEqual([...merged].sort(), ["theme-a", "theme-b"]);
});

test("loadout keys and perk slugs merge by the same rule", () => {
  /* Battle Royale's spent set carries both bare perk slugs and `kind:slug`
     loadout keys, and is merged into each side without being split first —
     the two namespaces cannot collide, so nothing has to tell them apart. */
  const merged = mergeExclusions(new Set(["item:toolbox"]), [
    new Set(["addon:bffs", "some-perk"]),
  ]);
  assert.ok(merged.has("item:toolbox"));
  assert.ok(merged.has("addon:bffs"));
  assert.ok(merged.has("some-perk"));
});

/* ---------------------------------------------------------------- */
/* seedModeForLink                                                    */
/* ---------------------------------------------------------------- */

test("today's daily seed restores as the Daily Challenge, not a custom seed", () => {
  for (const role of ["survivor", "killer"] as const) {
    assert.equal(seedModeForLink(dailyChallengeSeed(role), role), "daily");
  }
});

test("a daily seed for the OTHER role is a custom seed", () => {
  // The seed encodes the role, so a killer link opened as survivor is not
  // "today's challenge" for that visitor — it is just a fixed seed.
  const killerSeed = dailyChallengeSeed("killer");
  assert.equal(seedModeForLink(killerSeed, "survivor"), "custom");
});

test("anything a person typed is a custom seed", () => {
  for (const seed of ["hello", "2020-01-01-survivor", "", "  "]) {
    assert.equal(seedModeForLink(seed, "survivor"), "custom");
  }
});

test("the daily seed is shaped the way the URL test expects", () => {
  // e2e asserts /\d{4}-\d{2}-\d{2}-(survivor|killer)/ against this; pinning
  // the shape here means a change to it fails in one obvious place rather
  // than as a puzzling browser failure.
  assert.match(dailyChallengeSeed("survivor"), /^\d{4}-\d{2}-\d{2}-survivor$/);
  assert.match(dailyChallengeSeed("killer"), /^\d{4}-\d{2}-\d{2}-killer$/);
});
