// useSquad, rendered.
//
// The roll itself is covered by lib/squad-roll.test.ts. What is left here is
// everything that only goes wrong once React and localStorage are involved:
// settings that have to come back on a reload, a squad that must not outlive
// the settings it was rolled under, and a stored value written by some other
// version of the app.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { StrictMode } from "react";
import { act, renderHook } from "@testing-library/react";
import { useSquad, type SquadController } from "./use-squad";
import type { Perk } from "./types";

const STORAGE_KEY = "dbd-randomizer:squad";

/* StrictMode because that is how the app runs, and because it double-invokes
 * state updaters — a roll performed inside one would throw the dice twice per
 * click here and once in production. */
function setup() {
  const view = renderHook(() => useSquad(), { wrapper: StrictMode });
  return {
    get squad(): SquadController {
      return view.result.current;
    },
  };
}

const perk = (slug: string) => ({ slug, role: "survivor" }) as Perk;
const poolOf = (n: number) => Array.from({ length: n }, (_, i) => perk(`p${i + 1}`));
const stored = () => JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
const slugsOf = (s: SquadController) => s.squad.flat().map((p) => p.slug);

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

test("off by default, with a full lobby ready and nothing rolled", () => {
  const s = setup();
  assert.equal(s.squad.active, false);
  assert.equal(s.squad.players, 4);
  assert.deepEqual(s.squad.squad, []);
});

test("turning it on persists, so it survives a reload", () => {
  const s = setup();
  act(() => s.squad.toggle());
  assert.equal(s.squad.active, true);
  assert.deepEqual(stored(), { active: true, players: 4 });

  // A second mount is the reload. It comes up at the SSR-safe defaults and
  // the board's mount effect hydrates it, which is what the next test is
  // about — here we only care that the saved state comes back.
  const reopened = setup();
  act(() => reopened.squad.hydrate());
  assert.equal(reopened.squad.active, true);
});

test("a fresh mount ignores storage until it is hydrated", () => {
  /* This is the hydration-mismatch guard, and it is not a style preference.
   * Reading localStorage during the first client render puts the squad's
   * sections where the server sent a single loading grid, and React throws
   * "Hydration failed" for every returning visitor who left the mode on. It
   * shipped that way for one build and was found by reading the dev console,
   * not by a test — so here is the test. */
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ active: true, players: 2 }));
  const s = setup();
  assert.equal(s.squad.active, false, "first render must match the server's HTML");
  assert.equal(s.squad.players, 4);

  act(() => s.squad.hydrate());
  assert.equal(s.squad.active, true);
  assert.equal(s.squad.players, 2);
});

test("hydrating with nothing saved leaves the defaults alone", () => {
  const s = setup();
  act(() => s.squad.hydrate());
  assert.equal(s.squad.active, false);
  assert.equal(s.squad.players, 4);
});

test("a rolled squad has one build per player and no shared perk", () => {
  const s = setup();
  act(() => s.squad.toggle());
  act(() => s.squad.roll({ role: "survivor", pool: poolOf(40), buildSize: 4 }));

  assert.equal(s.squad.squad.length, 4);
  assert.deepEqual(
    s.squad.squad.map((b) => b.length),
    [4, 4, 4, 4],
  );
  const slugs = slugsOf(s.squad);
  assert.equal(new Set(slugs).size, slugs.length);
});

test("player count is respected and clamped to a real lobby", () => {
  const s = setup();
  act(() => s.squad.setPlayers(3));
  act(() => s.squad.roll({ role: "survivor", pool: poolOf(40), buildSize: 4 }));
  assert.equal(s.squad.squad.length, 3);

  act(() => s.squad.setPlayers(9));
  assert.equal(s.squad.players, 4);
  act(() => s.squad.setPlayers(0));
  assert.equal(s.squad.players, 2);
  act(() => s.squad.setPlayers(Number.NaN));
  assert.equal(s.squad.players, 4, "nonsense falls back to a full lobby");
});

test("changing the player count drops the squad rather than showing the wrong number of hands", () => {
  const s = setup();
  act(() => s.squad.toggle());
  act(() => s.squad.roll({ role: "survivor", pool: poolOf(40), buildSize: 4 }));
  assert.equal(s.squad.squad.length, 4);

  act(() => s.squad.setPlayers(2));
  assert.deepEqual(s.squad.squad, [], "a stale 4-hand squad under a '2' control reads as a bug");
});

test("turning the mode off clears what was on screen", () => {
  const s = setup();
  act(() => s.squad.toggle());
  act(() => s.squad.roll({ role: "survivor", pool: poolOf(40), buildSize: 4 }));
  act(() => s.squad.toggle());

  assert.equal(s.squad.active, false);
  assert.deepEqual(s.squad.squad, []);
});

test("a seed reproduces the whole squad, and no seed does not", () => {
  const pool = poolOf(40);
  const a = setup();
  act(() => a.squad.roll({ role: "survivor", pool, buildSize: 4, seed: "daily-1" }));
  const first = slugsOf(a.squad);

  const b = setup();
  act(() => b.squad.roll({ role: "survivor", pool, buildSize: 4, seed: "daily-1" }));
  assert.deepEqual(slugsOf(b.squad), first);

  act(() => b.squad.roll({ role: "survivor", pool, buildSize: 4, seed: "daily-2" }));
  assert.notDeepEqual(slugsOf(b.squad), first);
});

test("a pool too small for the lobby fills what it can instead of throwing", () => {
  const s = setup();
  act(() => s.squad.toggle());
  act(() => s.squad.roll({ role: "survivor", pool: poolOf(6), buildSize: 4 }));
  assert.deepEqual(
    s.squad.squad.map((b) => b.length),
    [2, 2, 1, 1],
  );
});

test("clear drops the squad without leaving the mode", () => {
  const s = setup();
  act(() => s.squad.toggle());
  act(() => s.squad.roll({ role: "survivor", pool: poolOf(40), buildSize: 4 }));
  act(() => s.squad.clear());

  assert.deepEqual(s.squad.squad, []);
  assert.equal(s.squad.active, true);
});

test("a stored value from another version of the app cannot break the board", () => {
  for (const bad of ['{"active":"yes","players":"lots"}', "[]", "null", "not json at all"]) {
    localStorage.setItem(STORAGE_KEY, bad);
    const s = setup();
    act(() => s.squad.hydrate());
    assert.equal(s.squad.active, false, `${bad} should not read as "on"`);
    assert.equal(s.squad.players, 4);
  }
});
