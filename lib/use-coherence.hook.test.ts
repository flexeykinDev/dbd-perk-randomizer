// useCoherence, rendered.
//
// Small surface, but it carries the hydration rule the squad hook learned the
// hard way: storage is read from an effect, never from a lazy initialiser,
// because the first client render has to match HTML that was produced with no
// window at all.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { StrictMode } from "react";
import { act, renderHook } from "@testing-library/react";
import { useCoherence, type CoherenceController } from "./use-coherence";

const STORAGE_KEY = "dbd-randomizer:coherence";

function setup() {
  const view = renderHook(() => useCoherence(), { wrapper: StrictMode });
  return {
    get c(): CoherenceController {
      return view.result.current;
    },
  };
}

beforeEach(() => {
  localStorage.clear();
});

test("starts at chaos, which is the roll the site has always done", () => {
  assert.equal(setup().c.level, 0);
});

test("a fresh mount ignores storage until it is hydrated", () => {
  localStorage.setItem(STORAGE_KEY, "3");
  const s = setup();
  assert.equal(s.c.level, 0, "first render must match the server's HTML");
  act(() => s.c.hydrate());
  assert.equal(s.c.level, 3);
});

test("the chosen level persists", () => {
  const s = setup();
  act(() => s.c.setLevel(2));
  assert.equal(s.c.level, 2);
  assert.equal(localStorage.getItem(STORAGE_KEY), "2");

  const reopened = setup();
  act(() => reopened.c.hydrate());
  assert.equal(reopened.c.level, 2);
});

test("hydrating with nothing saved leaves the default alone", () => {
  const s = setup();
  act(() => s.c.hydrate());
  assert.equal(s.c.level, 0);
});

test("a stored value from another version cannot put the roll in a state it cannot read", () => {
  for (const bad of ["9", "-1", "1.5", "synergy", "", "null", "[]"]) {
    localStorage.clear();
    localStorage.setItem(STORAGE_KEY, bad);
    const s = setup();
    act(() => s.c.hydrate());
    assert.equal(s.c.level, 0, `"${bad}" should leave the default in place`);
  }
});

test("setting a level that is not one refuses rather than storing it", () => {
  const s = setup();
  act(() => s.c.setLevel(2));
  // @ts-expect-error deliberately out of range, as a stray caller would be
  act(() => s.c.setLevel(7));
  assert.equal(s.c.level, 2, "the last valid level stands");
  assert.equal(localStorage.getItem(STORAGE_KEY), "2");
});
