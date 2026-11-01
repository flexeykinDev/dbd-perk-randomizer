import test from "node:test";
import assert from "node:assert/strict";
import { stableSlugs } from "./stable-slugs";

const suffix = (slug: string, character: string) =>
  `${slug}-${character.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

test("leaves a name nobody else shares alone", () => {
  const rows = [
    { slug: "jump-rope", character: "The Nightmare" },
    { slug: "begrimed-chains", character: "The Cannibal" },
  ];
  assert.deepEqual(stableSlugs(rows, new Map(), suffix), ["jump-rope", "begrimed-chains"]);
});

test("first come decides a collision the shipped data has never seen", () => {
  const rows = [
    { slug: "jump-rope", character: "The Nightmare" },
    { slug: "jump-rope", character: "The Good Guy" },
  ];
  assert.deepEqual(stableSlugs(rows, new Map(), suffix), [
    "jump-rope",
    "jump-rope-the-good-guy",
  ]);
});

// The actual 19 October failure: the wiki moved the Slasher's copy of
// "Mirror Shards" ahead of the Good Guy's, and the bare slug followed it.
test("the committed owner keeps the bare slug however late it appears", () => {
  const committed = new Map([["mirror-shards", "The Good Guy"]]);
  const reordered = [
    { slug: "mirror-shards", character: "The Slasher" },
    { slug: "mirror-shards", character: "The Good Guy" },
  ];
  assert.deepEqual(stableSlugs(reordered, committed, suffix), [
    "mirror-shards-the-slasher",
    "mirror-shards",
  ]);
  // ...and the same answer from the other ordering, which is the whole point:
  // the result is a function of the data, not of the scrape.
  const original = [...reordered].reverse();
  assert.deepEqual(stableSlugs(original, committed, suffix), [
    "mirror-shards",
    "mirror-shards-the-slasher",
  ]);
});

test("a third owner joining later disturbs neither of the first two", () => {
  const committed = new Map([
    ["mirror-shards", "The Good Guy"],
    ["mirror-shards-the-slasher", "The Slasher"],
  ]);
  const rows = [
    { slug: "mirror-shards", character: "The Unknown" },
    { slug: "mirror-shards", character: "The Slasher" },
    { slug: "mirror-shards", character: "The Good Guy" },
  ];
  assert.deepEqual(stableSlugs(rows, committed, suffix), [
    "mirror-shards-the-unknown",
    "mirror-shards-the-slasher",
    "mirror-shards",
  ]);
});

test("falls back to first come when the committed owner has left the game", () => {
  const committed = new Map([["mirror-shards", "The Retired"]]);
  const rows = [
    { slug: "mirror-shards", character: "The Good Guy" },
    { slug: "mirror-shards", character: "The Slasher" },
  ];
  assert.deepEqual(stableSlugs(rows, committed, suffix), [
    "mirror-shards",
    "mirror-shards-the-slasher",
  ]);
});

test("a suffix that would itself collide is counted rather than merged", () => {
  // Same name AND same owner. Hypothetical, but a silent merge would mean one
  // id and one icon for two different add-ons, so it has to stay distinct.
  const rows = [
    { slug: "jump-rope", character: "The Good Guy" },
    { slug: "jump-rope", character: "The Good Guy" },
    { slug: "jump-rope", character: "The Good Guy" },
  ];
  const out = stableSlugs(rows, new Map(), suffix);
  assert.equal(new Set(out).size, 3);
  assert.deepEqual(out, [
    "jump-rope",
    "jump-rope-the-good-guy",
    "jump-rope-the-good-guy-2",
  ]);
});

test("a suffixed slug colliding with a real bare slug stays distinct", () => {
  // "Mirror Shards" for The Slasher suffixes to "mirror-shards-the-slasher",
  // which is also a legitimate name some other add-on could slugify to.
  const rows = [
    { slug: "mirror-shards-the-slasher", character: "The Trapper" },
    { slug: "mirror-shards", character: "The Good Guy" },
    { slug: "mirror-shards", character: "The Slasher" },
  ];
  const out = stableSlugs(rows, new Map(), suffix);
  assert.equal(new Set(out).size, 3, out.join(", "));
});
