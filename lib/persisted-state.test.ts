// Everything the player has built up, read back from a payload they did not
// write today.
//
// Thirty-three keys hold pools, favourites, stats, history, Twitch settings
// and overlay layouts. All of them are written by whatever version of this
// app the visitor happened to have, and read by whatever version they have
// now — which is a contract nobody tests by using the site, because the two
// are almost always the same build.
//
// The cost of getting it wrong is quiet and permanent: someone's curated
// 200-perk pool resets, or a modal throws on open, and there is no error
// anywhere saying why. So each reader is given the same five hostile
// payloads: the current shape, an older one missing fields, a newer one
// carrying extra, outright rubbish, and an array of the wrong element type.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { renderHook, act } from "@testing-library/react";
import { getRoleStatsSummary, recordRoll } from "./stats";
import { getHistory, recordHistoryEntry } from "./history";
import { usePersistedSet } from "./use-persisted-set";
import { useObsLayouts } from "./obs-layouts";
import { getPerkBySlug, getPerksByRole } from "./perks";

const STATS_KEY = "dbd-randomizer:stats";
const HISTORY_KEY = "dbd-randomizer:history";
const EXCLUDED_KEY = "dbd-randomizer:excluded-perks";
const LAYOUTS_KEY = "dbd-randomizer:obs-layouts";

/** The payloads no reader may throw on, whatever it expects to find. */
const RUBBISH = [
  "not json at all",
  "null",
  '"a string"',
  "42",
  "true",
  "[]",
  "{}",
  '{"unexpected":"object"}',
  "[1,2,3]",
  '["a","b"]',
  '[null,null]',
  '[{"nothing":"useful"}]',
];

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

// --- stats ----------------------------------------------------------------

test("stats: a current payload round-trips", () => {
  const pool = getPerksByRole("survivor");
  recordRoll("survivor", pool.slice(0, 4));
  const summary = getRoleStatsSummary("survivor", pool);
  assert.equal(summary.totalBuilds, 1);
  assert.equal(summary.seen, 4);
});

test("stats: an older payload missing fields loads with defaults", () => {
  // Written before totalBuilds existed.
  localStorage.setItem(STATS_KEY, JSON.stringify({ survivor: { rolls: { adrenaline: 3 } } }));
  const summary = getRoleStatsSummary("survivor", getPerksByRole("survivor"));
  assert.equal(summary.totalBuilds, 0, "a missing counter is zero, not undefined");
  assert.equal(summary.seen, 1, "and the rolls that were there still count");
});

test("stats: a newer payload's extra fields do not destroy the known ones", () => {
  localStorage.setItem(
    STATS_KEY,
    JSON.stringify({
      survivor: { totalBuilds: 7, rolls: { adrenaline: 2 }, streak: 4, mood: "grim" },
      killer: { totalBuilds: 1, rolls: {} },
      version: 99,
    }),
  );
  const summary = getRoleStatsSummary("survivor", getPerksByRole("survivor"));
  assert.equal(summary.totalBuilds, 7);
  assert.equal(summary.seen, 1);
});

test("stats: rubbish is survived, and every number stays a number", () => {
  const pool = getPerksByRole("survivor");
  for (const bad of RUBBISH) {
    localStorage.setItem(STATS_KEY, bad);
    const summary = getRoleStatsSummary("survivor", pool);
    assert.ok(Number.isFinite(summary.totalBuilds), `${bad} -> totalBuilds ${summary.totalBuilds}`);
    assert.ok(Number.isFinite(summary.totalRolls), `${bad} -> totalRolls ${summary.totalRolls}`);
    assert.ok(Number.isFinite(summary.seen), `${bad} -> seen ${summary.seen}`);
    assert.equal(summary.poolSize, pool.length);
    assert.ok(Array.isArray(summary.top));
  }
});

test("stats: a rolls map of the wrong type does not produce NaN on screen", () => {
  // `rolls` is meant to be slug -> count. A string, an array or counts that
  // are not numbers all have to come back as zero rather than NaN, which
  // renders as "NaN builds" and looks like the site is broken.
  for (const rolls of ['"nope"', "[1,2,3]", '{"adrenaline":"lots"}', "null"]) {
    localStorage.setItem(STATS_KEY, `{"survivor":{"totalBuilds":1,"rolls":${rolls}}}`);
    const summary = getRoleStatsSummary("survivor", getPerksByRole("survivor"));
    assert.ok(Number.isFinite(summary.totalRolls), `rolls=${rolls} -> ${summary.totalRolls}`);
    for (const stat of summary.top) {
      assert.ok(Number.isFinite(stat.percent), `rolls=${rolls} -> percent ${stat.percent}`);
    }
  }
});

// --- history --------------------------------------------------------------

test("history: a current payload round-trips", () => {
  recordHistoryEntry({ mode: "perks", role: "survivor", keys: ["adrenaline", "resilience"] });
  const history = getHistory();
  assert.equal(history.length, 1);
  assert.deepEqual(history[0].keys, ["adrenaline", "resilience"]);
});

test("history: rubbish is survived and every entry is usable", () => {
  /* The list is rendered by mapping each entry's `keys`. An entry without
   * one throws inside the modal's render, which takes the page down — not
   * the row. Anything that survives the read has to be safe to render. */
  for (const bad of RUBBISH) {
    localStorage.setItem(HISTORY_KEY, bad);
    const history = getHistory();
    assert.ok(Array.isArray(history), `${bad} did not come back as a list`);
    for (const entry of history) {
      assert.ok(Array.isArray(entry.keys), `${bad} -> entry with keys ${JSON.stringify(entry.keys)}`);
      assert.ok(entry.mode === "perks" || entry.mode === "loadout", `${bad} -> mode ${entry.mode}`);
      assert.ok(entry.role === "survivor" || entry.role === "killer", `${bad} -> role ${entry.role}`);
    }
  }
});

test("history: an older entry missing fields is either repaired or dropped", () => {
  localStorage.setItem(
    HISTORY_KEY,
    JSON.stringify([
      { mode: "perks", role: "survivor", keys: ["adrenaline"] },
      { mode: "perks", role: "survivor" },
      { keys: ["resilience"] },
    ]),
  );
  for (const entry of getHistory()) {
    assert.ok(Array.isArray(entry.keys));
    assert.ok(entry.mode === "perks" || entry.mode === "loadout");
  }
});

test("history: a newer entry's extra fields survive the read", () => {
  localStorage.setItem(
    HISTORY_KEY,
    JSON.stringify([
      { id: "x", at: 1, mode: "perks", role: "killer", keys: ["whispers"], note: "meta", stars: 5 },
    ]),
  );
  const history = getHistory();
  assert.equal(history.length, 1);
  assert.deepEqual(history[0].keys, ["whispers"]);
  assert.equal(history[0].role, "killer");
});

// --- pools and favourites -------------------------------------------------

function setOf(key: string) {
  const view = renderHook(() => usePersistedSet(key));
  act(() => view.result.current.hydrate());
  return view.result.current.values;
}

test("pools: a current payload round-trips", () => {
  localStorage.setItem(EXCLUDED_KEY, JSON.stringify(["adrenaline", "resilience"]));
  assert.deepEqual([...setOf(EXCLUDED_KEY)].sort(), ["adrenaline", "resilience"]);
});

test("pools: rubbish comes back empty rather than throwing", () => {
  for (const bad of RUBBISH) {
    localStorage.setItem(EXCLUDED_KEY, bad);
    const values = setOf(EXCLUDED_KEY);
    assert.ok(values instanceof Set, `${bad} did not come back as a Set`);
    for (const v of values) assert.equal(typeof v, "string", `${bad} kept a non-string`);
  }
});

test("pools: an array of the wrong element type keeps only the strings", () => {
  localStorage.setItem(
    EXCLUDED_KEY,
    JSON.stringify(["adrenaline", 42, null, { slug: "resilience" }, "lithe"]),
  );
  assert.deepEqual([...setOf(EXCLUDED_KEY)].sort(), ["adrenaline", "lithe"]);
});

// --- OBS layouts ----------------------------------------------------------

function layoutsFrom(stored: string) {
  localStorage.setItem(LAYOUTS_KEY, stored);
  return renderHook(() => useObsLayouts()).result.current.layouts;
}

test("layouts: a current payload round-trips", () => {
  const snapshot = {
    scale: 100, nameScale: 100, canvasWidth: 800, canvasHeight: 300,
    showNames: true, showCharacter: false, darkBg: false,
    characterScale: 100, positions: null, characterPosition: null,
  };
  const layouts = layoutsFrom(JSON.stringify([{ name: "Stream", snapshot }]));
  assert.equal(layouts.length, 1);
  assert.equal(layouts[0].name, "Stream");
  assert.equal(layouts[0].snapshot.scale, 100);
});

test("layouts: an older snapshot without skin/frame/motion still loads", () => {
  // Those three were added after layouts shipped; the type already marks
  // them optional, and darkBg is what an old snapshot used instead.
  const old = {
    scale: 120, nameScale: 100, canvasWidth: 800, canvasHeight: 300,
    showNames: true, showCharacter: true, darkBg: true,
    characterScale: 100, positions: null, characterPosition: null,
  };
  const layouts = layoutsFrom(JSON.stringify([{ name: "Old", snapshot: old }]));
  assert.equal(layouts.length, 1);
  assert.equal(layouts[0].snapshot.darkBg, true);
  assert.equal(layouts[0].snapshot.skin, undefined);
});

test("layouts: rubbish comes back as a list, never something unrenderable", () => {
  /* The modal maps over this to draw a row per layout. A stored object or
   * string would make `.map` throw during render and take the OBS dialog
   * down — on stream, with no way to tell why. */
  for (const bad of RUBBISH) {
    const layouts = layoutsFrom(bad);
    assert.ok(Array.isArray(layouts), `${bad} did not come back as a list`);
    for (const layout of layouts) {
      assert.equal(typeof layout.name, "string", `${bad} -> name ${JSON.stringify(layout.name)}`);
      assert.ok(layout.snapshot && typeof layout.snapshot === "object", `${bad} -> bad snapshot`);
    }
  }
});

// --- slugs ----------------------------------------------------------------

test("a perk retired from the game is dropped, a renamed one still resolves", () => {
  /* Both halves matter to a saved pool. A slug that no longer exists must
   * not appear in a build; a slug the game renamed must keep working, or
   * every pool and favourites list naming it silently loses that perk. */
  assert.equal(getPerkBySlug("a-perk-that-never-existed"), undefined);

  const renamed = getPerkBySlug("decisive-strike");
  assert.ok(renamed, "a renamed perk must still resolve");
  assert.equal(renamed.slug, "will-to-live", "and resolve to its current slug");

  for (const [oldSlug, newSlug] of [
    ["deadlock", "no-holds-barred"],
    ["dying-light", "cull-the-weak"],
  ]) {
    assert.equal(getPerkBySlug(oldSlug)?.slug, newSlug, `${oldSlug} should follow its rename`);
  }
});

test("a stored pool of retired slugs does not resurrect them", () => {
  localStorage.setItem(
    EXCLUDED_KEY,
    JSON.stringify(["adrenaline", "gone-forever", "also-gone"]),
  );
  const stored = setOf(EXCLUDED_KEY);
  // The set itself keeps the strings — it is a list of slugs, not of perks —
  // but nothing resolves the dead ones into the pool.
  const resolved = [...stored].map((slug) => getPerkBySlug(slug)).filter(Boolean);
  assert.equal(resolved.length, 1);
});
