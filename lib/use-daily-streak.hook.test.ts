// useDailyStreak, rendered.
//
// The arithmetic is covered exhaustively in lib/daily-streak.test.ts. What is
// left here is everything that only goes wrong once React and localStorage
// are involved: the hydration rule, a saved payload written by some other
// version, and the promise that the number never leaves the browser.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { StrictMode } from "react";
import { act, renderHook } from "@testing-library/react";
import { useDailyStreak, type DailyStreakController } from "./use-daily-streak";
import { todayUtcDateString } from "./seeded-random";

const STORAGE_KEY = "dbd-randomizer:daily-streak";

function setup() {
  const view = renderHook(() => useDailyStreak(), { wrapper: StrictMode });
  return {
    get s(): DailyStreakController {
      return view.result.current;
    },
  };
}

const stored = () => JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
const today = () => todayUtcDateString();
const daysAgo = (n: number) => {
  const d = new Date(`${todayUtcDateString()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};

beforeEach(() => {
  localStorage.clear();
});

test("a player who has never taken it has no streak", () => {
  const s = setup();
  act(() => s.s.hydrate());
  assert.equal(s.s.streak.current, 0);
  assert.equal(s.s.streak.longest, 0);
});

test("a fresh mount shows nothing until it is hydrated", () => {
  // The hydration rule: the first client render has to match HTML produced
  // with no window, or React throws for every returning player.
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ current: 4, longest: 9, lastDay: today() }));
  const s = setup();
  assert.equal(s.s.streak.current, 0, "first render must match the server's HTML");
  act(() => s.s.hydrate());
  assert.equal(s.s.streak.current, 4);
  assert.equal(s.s.streak.longest, 9);
});

test("taking it records today and persists", () => {
  const s = setup();
  act(() => s.s.hydrate());
  act(() => s.s.record());

  assert.equal(s.s.streak.current, 1);
  assert.equal(s.s.streak.longest, 1);
  assert.deepEqual(stored(), { current: 1, longest: 1, lastDay: today() });
});

test("taking it twice in a day counts once, and writes once", () => {
  const s = setup();
  act(() => s.s.hydrate());
  act(() => s.s.record());
  localStorage.removeItem(STORAGE_KEY); // so a second write would be visible

  act(() => s.s.record());
  assert.equal(s.s.streak.current, 1);
  assert.equal(stored(), null, "the second call should not have written anything");
});

test("yesterday's run continues today", () => {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ current: 3, longest: 5, lastDay: daysAgo(1) }),
  );
  const s = setup();
  act(() => s.s.hydrate());
  assert.equal(s.s.streak.current, 3, "still live until today is taken");

  act(() => s.s.record());
  assert.equal(s.s.streak.current, 4);
  assert.equal(s.s.streak.longest, 5);
});

test("a run the calendar already ended reads as zero without being opened", () => {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ current: 6, longest: 6, lastDay: daysAgo(3) }),
  );
  const s = setup();
  act(() => s.s.hydrate());
  assert.equal(s.s.streak.current, 0, "three days away is not a live run");
  assert.equal(s.s.streak.longest, 6, "but the record stands");

  act(() => s.s.record());
  assert.equal(s.s.streak.current, 1, "today starts a new one");
  assert.equal(s.s.streak.longest, 6);
});

test("a payload from another version cannot put a NaN on screen", () => {
  for (const bad of [
    '{"current":"lots","longest":null,"lastDay":"yesterday"}',
    '{"current":-4,"longest":-9,"lastDay":123}',
    '{"current":1.5,"longest":2.5,"lastDay":"2026-02-30"}',
    "[]",
    "null",
    "not json",
  ]) {
    localStorage.clear();
    localStorage.setItem(STORAGE_KEY, bad);
    const s = setup();
    act(() => s.s.hydrate());
    assert.ok(Number.isInteger(s.s.streak.current), `${bad} -> ${s.s.streak.current}`);
    assert.ok(Number.isInteger(s.s.streak.longest), `${bad} -> ${s.s.streak.longest}`);
    assert.ok(s.s.streak.current >= 0 && s.s.streak.longest >= 0);
  }
});

test("a record smaller than the run it bounds is repaired, not believed", () => {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ current: 8, longest: 2, lastDay: today() }),
  );
  const s = setup();
  act(() => s.s.hydrate());
  assert.equal(s.s.streak.longest, 8, "the best cannot be less than the current run");
});

test("nothing is written anywhere but this one local key", () => {
  /* The README's privacy position is that Firebase carries exactly two
   * things. A per-person streak is what that position exists to keep out of
   * a shared database, so this checks the blunt version of the claim: one
   * key, in localStorage, and nothing in sessionStorage. */
  const s = setup();
  act(() => s.s.hydrate());
  act(() => s.s.record());

  assert.deepEqual(Object.keys(localStorage), [STORAGE_KEY]);
  assert.equal(sessionStorage.length, 0);
});
