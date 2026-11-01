import test from "node:test";
import assert from "node:assert/strict";
import { available, isAvailable } from "./availability";

const on = (iso: string) => new Date(`${iso}T12:00:00Z`);

test("content with no date is in the game", () => {
  assert.equal(isAvailable({}, on("2026-11-01")), true);
});

test("a dated piece is hidden before its day and shown on it", () => {
  const terrifier = { availableFrom: "2026-11-24" };
  assert.equal(isAvailable(terrifier, on("2026-11-23")), false);
  assert.equal(isAvailable(terrifier, on("2026-11-24")), true);
  assert.equal(isAvailable(terrifier, on("2026-12-01")), true);
});

test("the whole release day counts, in every timezone", () => {
  const piece = { availableFrom: "2026-11-24" };
  // A visitor just past midnight in Auckland and one still on the 23rd in
  // Los Angeles are both "on the 24th" by UTC calendar day for part of it;
  // what must not happen is the edge flipping mid-day for the same person.
  assert.equal(isAvailable(piece, new Date("2026-11-24T00:00:00Z")), true);
  assert.equal(isAvailable(piece, new Date("2026-11-24T23:59:59Z")), true);
  assert.equal(isAvailable(piece, new Date("2026-11-23T23:59:59Z")), false);
});

test("a malformed date hides rather than shows", () => {
  // No one is watching a browser, so the safe direction is the only one.
  for (const bad of ["soon", "2026-13-45x", "24/11/2026", ""]) {
    assert.equal(isAvailable({ availableFrom: bad }, on("2030-01-01")), false, bad);
  }
});

test("available() keeps order and drops only the unreleased", () => {
  const rows = [
    { slug: "a" },
    { slug: "b", availableFrom: "2026-11-24" },
    { slug: "c" },
    { slug: "d", availableFrom: "2026-01-01" },
  ];
  assert.deepEqual(
    available(rows, on("2026-11-01")).map((r) => r.slug),
    ["a", "c", "d"],
  );
  assert.deepEqual(
    available(rows, on("2026-11-24")).map((r) => r.slug),
    ["a", "b", "c", "d"],
  );
});

/* The contract the shipped data has to keep, checked against the real files
 * rather than fixtures. Getting this wrong in either direction is a bug a
 * visitor would see: leak, and the site offers a build nobody can play; hide
 * too much, and a Chapter that is out is missing from the randomizer. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { perks } from "./perks";
import { addons, items, offerings } from "./loadout";

const dataDir = join(dirname(fileURLToPath(import.meta.url)), "..", "data");
const raw = <T>(file: string): T[] => JSON.parse(readFileSync(join(dataDir, file), "utf8"));

test("nothing scheduled reaches the client's pools", () => {
  const exported = [...perks, ...items, ...addons, ...offerings] as { slug: string; availableFrom?: string }[];
  const leaked = exported.filter((p) => p.availableFrom).map((p) => p.slug);
  assert.deepEqual(leaked, [], `unreleased content in the rollable pool: ${leaked}`);
});

test("scheduled content is in the files, so release day needs no scrape", () => {
  // The other half. If this ever reads zero it is not a failure of the data -
  // it means nothing is pending - so it asserts the shape of what IS there
  // rather than that something is.
  const all = [
    ...raw<{ slug: string; availableFrom?: string }>("perks.json"),
    ...raw<{ slug: string; availableFrom?: string }>("addons.json"),
    ...raw<{ slug: string; availableFrom?: string }>("items.json"),
    ...raw<{ slug: string; availableFrom?: string }>("offerings.json"),
  ];
  const scheduled = all.filter((p) => p.availableFrom);
  const malformed = scheduled.filter((p) => !/^\d{4}-\d{2}-\d{2}$/.test(p.availableFrom!));
  assert.deepEqual(malformed.map((p) => p.slug), [], "a date the client cannot read hides the piece forever");
  // Every scheduled piece must still be hidden today, or it should not carry
  // a date at all - a past date left behind is dead weight the next scrape
  // should have cleared.
  const stale = scheduled.filter((p) => isAvailable(p));
  assert.deepEqual(stale.map((p) => p.slug), [], "released content still carrying availableFrom - rescrape to clear it");
});

test("a scheduled character is wholly scheduled, never half", () => {
  // Half a Chapter is the worst outcome: a killer you can roll with no add-on
  // pool, or add-ons for a killer who is not in the picker.
  const rows = [
    ...raw<{ character?: string; availableFrom?: string }>("perks.json"),
    ...raw<{ character?: string; availableFrom?: string }>("addons.json"),
  ].filter((r) => r.character);
  const byCharacter = new Map<string, Set<string>>();
  for (const row of rows) {
    const set = byCharacter.get(row.character!) ?? new Set<string>();
    set.add(row.availableFrom ?? "live");
    byCharacter.set(row.character!, set);
  }
  const split = [...byCharacter].filter(([, dates]) => dates.size > 1).map(([c]) => c);
  assert.deepEqual(split, [], `characters with some content live and some not: ${split}`);
});

/* The trailer follows the same clock. Worth its own check because it is the
 * one piece of chapter content that is hand-written rather than scraped, so
 * nothing else would catch a typo in the date or a missing embed. */
import { currentTrailer } from "./trailer";

test("the trailer swaps itself on release day", () => {
  const before = currentTrailer(new Date("2026-11-23T12:00:00Z"));
  const after = currentTrailer(new Date("2026-11-24T12:00:00Z"));
  for (const trailer of [before, after]) {
    assert.match(trailer.embedUrl, /^https:\/\/www\.youtube\.com\/embed\/[\w-]{11}$/, trailer.embedUrl);
    assert.ok(trailer.title.length > 0);
  }
  // Only meaningful while a next one is pending; once it has gone live and
  // been folded into the top level these are equal, which is correct too.
  const file = JSON.parse(
    readFileSync(join(dataDir, "trailer.json"), "utf8"),
  ) as { next?: { availableFrom?: string; embedUrl: string } };
  if (file.next && !isAvailable(file.next)) {
    assert.notEqual(before.embedUrl, after.embedUrl, "a pending trailer that never takes over");
    assert.equal(after.embedUrl, file.next.embedUrl);
  }
});
