// Streak arithmetic, walked day by day.
//
// All of it is calendar maths on UTC day strings, which means all of it can
// be tested exactly — no clock, no timezone, no tolerance. That is the whole
// reason the dates are passed in rather than read: a feature that changes
// behaviour at midnight is not one to verify by waiting for midnight.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  advanceStreak,
  daysBetween,
  EMPTY_STREAK,
  isUtcDay,
  viewStreak,
  type StreakState,
} from "./daily-streak";

const state = (current: number, longest: number, lastDay: string | null): StreakState => ({
  current,
  longest,
  lastDay,
});

test("the first ever day is a streak of one", () => {
  const after = advanceStreak(EMPTY_STREAK, "2026-09-26");
  assert.deepEqual(after, state(1, 1, "2026-09-26"));
});

test("consecutive days build the run", () => {
  let s = EMPTY_STREAK;
  for (const day of ["2026-09-24", "2026-09-25", "2026-09-26", "2026-09-27"]) {
    s = advanceStreak(s, day);
  }
  assert.deepEqual(s, state(4, 4, "2026-09-27"));
});

test("taking it twice on the same day is still one day", () => {
  const once = advanceStreak(EMPTY_STREAK, "2026-09-26");
  const twice = advanceStreak(once, "2026-09-26");
  assert.deepEqual(twice, once, "the second visit must change nothing at all");
});

test("a one-day gap ends the run and starts a new one", () => {
  // Played the 24th and 25th, missed the 26th, came back on the 27th.
  let s = advanceStreak(advanceStreak(EMPTY_STREAK, "2026-09-24"), "2026-09-25");
  assert.equal(s.current, 2);
  s = advanceStreak(s, "2026-09-27");
  assert.equal(s.current, 1, "the missed day broke it");
  assert.equal(s.longest, 2, "but the best run is kept");
});

test("a multi-day gap does the same", () => {
  let s = EMPTY_STREAK;
  for (const day of ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05"]) {
    s = advanceStreak(s, day);
  }
  assert.equal(s.current, 5);
  s = advanceStreak(s, "2026-10-14");
  assert.deepEqual(s, state(1, 5, "2026-10-14"));
});

test("a clock that jumps backwards restarts rather than extending", () => {
  /* A device correcting itself, a VM resuming from a snapshot, a date set by
   * hand. Counting it as a gap of -1 would extend the run for a day that has
   * not happened yet; ignoring it would freeze the streak until real time
   * caught up. Restarting loses nothing, because the longest is untouched. */
  let s = EMPTY_STREAK;
  for (const day of ["2026-09-24", "2026-09-25", "2026-09-26"]) s = advanceStreak(s, day);
  assert.equal(s.current, 3);

  const back = advanceStreak(s, "2026-09-20");
  assert.equal(back.current, 1);
  assert.equal(back.longest, 3, "the best run survives a wrong clock");
  assert.equal(back.lastDay, "2026-09-20");
});

test("the longest never goes down", () => {
  let s = EMPTY_STREAK;
  for (const day of ["2026-01-01", "2026-01-02", "2026-01-03"]) s = advanceStreak(s, day);
  const best = s.longest;
  assert.equal(best, 3);

  // Three separate single days, each breaking the one before.
  for (const day of ["2026-02-01", "2026-03-01", "2026-04-01"]) {
    s = advanceStreak(s, day);
    assert.equal(s.current, 1);
    assert.equal(s.longest, best);
  }
});

test("a longer run later replaces the record", () => {
  let s = EMPTY_STREAK;
  for (const day of ["2026-01-01", "2026-01-02"]) s = advanceStreak(s, day);
  assert.equal(s.longest, 2);
  for (const day of ["2026-03-01", "2026-03-02", "2026-03-03", "2026-03-04"]) {
    s = advanceStreak(s, day);
  }
  assert.equal(s.current, 4);
  assert.equal(s.longest, 4);
});

test("month and year boundaries are ordinary days", () => {
  // The kind of arithmetic that goes wrong when someone adds 86400000 to a
  // local-time Date and lands on a DST changeover.
  assert.equal(advanceStreak(state(3, 3, "2026-01-31"), "2026-02-01").current, 4);
  assert.equal(advanceStreak(state(3, 3, "2026-12-31"), "2027-01-01").current, 4);
  assert.equal(advanceStreak(state(3, 3, "2028-02-28"), "2028-02-29").current, 4, "leap day");
  assert.equal(advanceStreak(state(3, 3, "2028-02-29"), "2028-03-01").current, 4);
  // And a non-leap year does not have a 29th to step onto.
  assert.equal(advanceStreak(state(3, 3, "2026-02-28"), "2026-03-01").current, 4);
});

test("a whole year, day by day, never loses count", () => {
  // Cheap, and it walks every month boundary and the DST changeovers that
  // would exist if local time were involved anywhere.
  let s = EMPTY_STREAK;
  const day = new Date(Date.UTC(2026, 0, 1));
  for (let i = 0; i < 365; i++) {
    s = advanceStreak(s, day.toISOString().slice(0, 10));
    day.setUTCDate(day.getUTCDate() + 1);
  }
  assert.equal(s.current, 365);
  assert.equal(s.longest, 365);
});

test("viewStreak ends a run the calendar already ended", () => {
  const s = state(6, 6, "2026-09-20");
  // Looking on the same day, and the day after, the run is still alive.
  assert.equal(viewStreak(s, "2026-09-20").current, 6);
  assert.equal(viewStreak(s, "2026-09-21").current, 6);
  // Two days on it is over, without anyone having had to open the site.
  assert.equal(viewStreak(s, "2026-09-22").current, 0);
  assert.equal(viewStreak(s, "2026-10-01").current, 0);
  // The record survives being shown.
  assert.equal(viewStreak(s, "2026-10-01").longest, 6);
});

test("viewStreak leaves a player who has never taken it alone", () => {
  assert.deepEqual(viewStreak(EMPTY_STREAK, "2026-09-26"), EMPTY_STREAK);
});

test("viewStreak does not record anything", () => {
  const s = state(2, 5, "2026-09-25");
  const shown = viewStreak(s, "2026-09-26");
  assert.equal(shown.lastDay, "2026-09-25", "looking is not playing");
});

test("daysBetween counts calendar days in both directions", () => {
  assert.equal(daysBetween("2026-09-25", "2026-09-26"), 1);
  assert.equal(daysBetween("2026-09-26", "2026-09-26"), 0);
  assert.equal(daysBetween("2026-09-26", "2026-09-25"), -1);
  assert.equal(daysBetween("2026-01-31", "2026-02-01"), 1);
  assert.equal(daysBetween("2026-12-31", "2027-01-01"), 1);
  assert.equal(daysBetween("2026-01-01", "2026-12-31"), 364);
});

test("a malformed day cannot corrupt a saved streak", () => {
  const s = state(3, 7, "2026-09-25");
  for (const bad of ["", "today", "2026-9-5", "26-09-25", "2026-13-01", "2026-02-30", "not a day"]) {
    assert.equal(isUtcDay(bad), false, `"${bad}" should not pass as a day`);
    assert.deepEqual(advanceStreak(s, bad), s, `advancing on "${bad}" must change nothing`);
    assert.deepEqual(viewStreak(s, bad), s, `viewing on "${bad}" must change nothing`);
  }
  assert.ok(isUtcDay("2026-02-28"));
  assert.ok(isUtcDay("2028-02-29"), "a real leap day is a real day");
});

test("a saved state with a nonsense lastDay recovers rather than throwing", () => {
  // Something another version of the app, or a hand edit, could have left.
  const broken = state(4, 9, "yesterday");
  const after = advanceStreak(broken, "2026-09-26");
  assert.deepEqual(after, state(1, 9, "2026-09-26"), "unreadable history restarts the run");
  assert.deepEqual(viewStreak(broken, "2026-09-26"), broken);
});
