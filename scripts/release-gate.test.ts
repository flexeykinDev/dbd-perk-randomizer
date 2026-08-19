// Guards the guard. release-gate.ts is the only thing standing between
// wiki.gg's pre-release pages and the live randomizer, and it fails in a
// direction nobody notices: if it silently started treating every date as
// released, the data would simply gain a Chapter early and look fine. Run
// by `npm test`, which CI runs on every push.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  gateScrapedRows,
  isReleased,
  partitionByRelease,
  ReleaseDateError,
} from "./release-gate";

const NOW = new Date("2026-08-18T12:00:00Z");

test("a past date counts as released", () => {
  assert.equal(isReleased("2025-09-23", "x", NOW), true);
});

test("release day itself counts as released", () => {
  assert.equal(isReleased("2026-08-18", "x", NOW), true);
});

test("a future date is held back", () => {
  assert.equal(isReleased("2026-08-19", "x", NOW), false);
  assert.equal(isReleased("2026-08-25", "x", NOW), false);
});

test("a missing or malformed date throws rather than guessing", () => {
  // Both defaults would be wrong: "released" ships unreleased content,
  // "unreleased" silently drops a hand-authored entry.
  for (const bad of [undefined, "", "   ", "25 Aug 2026", "2026-8-5", "2026/08/05"]) {
    assert.throws(() => isReleased(bad, "Entry", NOW), ReleaseDateError, `expected throw for ${JSON.stringify(bad)}`);
  }
});

test("partitionByRelease splits and reports what it held", () => {
  const { live, pending } = partitionByRelease(
    [
      { n: "Krasue", d: "2025-09-23" },
      { n: "Judgment", d: "2026-08-25" },
      { n: "Slasher", d: "2026-06-16" },
    ],
    (e) => e.d,
    (e) => e.n,
    NOW,
  );
  assert.deepEqual(live.map((e) => e.n), ["Krasue", "Slasher"]);
  assert.deepEqual(pending.map((p) => p.entry.n), ["Judgment"]);
});

// The shipped data files are the actual thing being protected, so assert
// against them directly rather than only against synthetic entries.
const dataDir = join(dirname(fileURLToPath(import.meta.url)), "../data");
for (const file of ["supplemental-perks.en.json", "supplemental-addons.en.json"]) {
  test(`every entry in ${file} has a usable releasedAt`, () => {
    const raw = JSON.parse(readFileSync(join(dataDir, file), "utf8"));
    const entries: { character: string; releasedAt?: string }[] = raw.entries ?? [];
    assert.ok(entries.length > 0, `${file} has no entries`);
    for (const entry of entries) {
      assert.doesNotThrow(
        () => isReleased(entry.releasedAt, entry.character, NOW),
        `${entry.character} in ${file} has a missing/malformed releasedAt`,
      );
    }
  });
}

/* ------------------------------------------------------------------ */
/* gateScrapedRows — the gate for rows read off a wiki page             */
/* ------------------------------------------------------------------ */

interface Row {
  slug: string;
  character: string;
  upcoming: boolean;
}
const row = (slug: string, character: string, upcoming = false): Row => ({
  slug,
  character,
  upcoming,
});

const gate = (rows: Row[], overrides: Partial<Parameters<typeof gateScrapedRows<Row>>[1]> = {}) =>
  gateScrapedRows(rows, {
    getCharacter: (r) => r.character,
    getSlug: (r) => r.slug,
    isUpcoming: (r) => r.upcoming,
    knownCharacters: new Set(["Meg", "Nurse"]),
    knownSlugs: new Set(["sprint-burst", "a-nurse-s-calling"]),
    releaseDates: {},
    now: NOW,
    ...overrides,
  });

test("a character already in the data passes, new perks and all", () => {
  const { live, held } = gate([row("new-meg-perk", "Meg")]);
  assert.equal(held.length, 0);
  assert.deepEqual(live.map((r) => r.slug), ["new-meg-perk"]);
});

test("an unknown character is held when nobody has dated it", () => {
  const { live, held } = gate([row("lay-waste", "Judgment")]);
  assert.equal(live.length, 0);
  assert.equal(held.length, 1);
  assert.match(held[0].reason, /never shipped/);
});

test("an unknown character with a future date is held until that day", () => {
  const dates = { Judgment: "2026-08-25" };
  assert.equal(gate([row("lay-waste", "Judgment")], { releaseDates: dates }).live.length, 0);
  assert.equal(
    gate([row("lay-waste", "Judgment")], { releaseDates: dates, now: new Date("2026-08-25T00:00:00Z") })
      .live.length,
    1,
  );
});

test("a brand-new perk marked as an upcoming patch is held", () => {
  const { live, held } = gate([row("keep-them-waiting", "Meg", true)]);
  assert.equal(live.length, 0);
  assert.match(held[0].reason, /unreleased patch/);
});

test("an already-shipped perk is not held by the upcoming-patch flag", () => {
  // The flag marks a description written ahead of a patch, and sits on
  // perks that have been live for years — on its own it must never
  // withdraw something players already have.
  const { live, held } = gate([row("sprint-burst", "Meg", true)]);
  assert.equal(held.length, 0);
  assert.deepEqual(live.map((r) => r.slug), ["sprint-burst"]);
});

test("a malformed date fails loudly rather than being guessed at", () => {
  assert.throws(
    () => gate([row("x", "Judgment")], { releaseDates: { Judgment: "25/08/2026" } }),
    ReleaseDateError,
  );
});

test("the shipped release dates would hold back today's unreleased chapters", () => {
  // The end-to-end check: the real file, against the characters wiki.gg is
  // currently documenting ahead of release.
  const dates = JSON.parse(
    readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../data/character-release-dates.json"), "utf8"),
  ).characters as Record<string, string>;
  for (const [character, releasedAt] of Object.entries(dates)) {
    assert.doesNotThrow(
      () => isReleased(releasedAt, character, NOW),
      `${character} has an unusable date`,
    );
  }
  const { live } = gate(
    [row("lay-waste", "Judgment"), row("boon-steadfast", "Aurora")],
    { releaseDates: dates },
  );
  assert.deepEqual(live, [], "an unreleased chapter would have shipped");
});

test("content with no owning character skips the character rule", () => {
  // Items and offerings belong to everybody, so there is no release date
  // that could gate them — only "brand new and flagged for an unreleased
  // patch" applies.
  const nullChar = (rows: Row[]) =>
    gateScrapedRows(rows, {
      getCharacter: () => null,
      getSlug: (r) => r.slug,
      isUpcoming: (r) => r.upcoming,
      knownCharacters: new Set<string>(),
      knownSlugs: new Set(["flashlight"]),
      releaseDates: {},
      now: NOW,
    });

  assert.equal(nullChar([row("brand-new-item", "")]).live.length, 1);
  assert.equal(nullChar([row("flashlight", "", true)]).live.length, 1);
  assert.equal(nullChar([row("brand-new-item", "", true)]).held.length, 1);
});
