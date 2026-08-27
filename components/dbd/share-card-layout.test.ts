// The export card's arithmetic, checked without rendering anything.
//
// This is the part of the card that has actually broken, four separate times,
// each found by looking at an export: a "2x2" that came out 3 + 1, eight
// pieces on one line, a loadout sized for the landscape card overflowing the
// story band and printing the Add-on and Offering names on top of each other.
//
// e2e/share-card.spec.ts measures 72 real layouts in a browser and is the only
// thing that can catch a label physically colliding with its neighbour. What
// it cannot do cheaply is enumerate — six role/mode cases times six random
// rolls is not every shape. These are the shapes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { landscapePortraitLayout, shareCardLayout } from "./share-card-layout";
import { BAND_PAD_L, BAND_PAD_R, CANVAS_SIZE } from "./share-card-metrics";
import type { ShareCardPiece } from "./share-card-types";

type Mode = "perks" | "loadout" | "all";

const piece = (kind: string | undefined, i: number, name = `Name ${i}`): ShareCardPiece => ({
  slug: `${kind ?? "perk"}-${i}`,
  icon: "/x.webp",
  name: { en: name, ru: name },
  kind,
});

const perks = (n: number) => Array.from({ length: n }, (_, i) => piece(undefined, i));
const loadout = (addons = 2) => [
  piece("item", 0),
  ...Array.from({ length: addons }, (_, i) => piece("addon", i)),
  piece("offering", 0),
];

function layoutFor(
  which: "landscape" | "story",
  mode: Mode,
  pieces: ShareCardPiece[],
  extra: { character?: string | null; title?: string } = {},
) {
  return shareCardLayout({
    layout: which,
    mode,
    role: "survivor",
    language: "en",
    pieces,
    character: extra.character ?? null,
    title: extra.title ?? "Random build",
  });
}

/* ---------------------------------------------------------------- */
/* The band is sized to its contents                                  */
/* ---------------------------------------------------------------- */

test("the band is its contents plus its own padding, never the whole card", () => {
  /* Pinning the band left-to-right instead stretched it across the entire
     right half and left a third of it visibly empty in every mode but "all". */
  for (const which of ["landscape", "story"] as const) {
    const l = layoutFor(which, "perks", perks(4));
    assert.ok(
      l.bandWidth < CANVAS_SIZE[which].width,
      `${which}: a band as wide as the card is the bug this guards`,
    );
    assert.ok(l.bandWidth > BAND_PAD_L + BAND_PAD_R, `${which}: the band has no contents`);
  }
});

test("a bigger build gets a wider band", () => {
  const two = layoutFor("landscape", "perks", perks(2)).bandWidth;
  const four = layoutFor("landscape", "perks", perks(4)).bandWidth;
  assert.ok(four > two, "the band did not grow with its contents");
});

test("the band stops growing once a row is full", () => {
  // Landscape wraps at four, so five perks are two rows — the band's WIDTH is
  // the same, and it is the height that changes. A band that kept widening
  // past the wrap point is how eight pieces once came out on one line.
  const four = layoutFor("landscape", "perks", perks(4)).bandWidth;
  const eight = layoutFor("landscape", "perks", perks(8)).bandWidth;
  assert.equal(eight, four);
});

/* ---------------------------------------------------------------- */
/* Story is not landscape with different numbers                      */
/* ---------------------------------------------------------------- */

test("the story band fits the room TikTok leaves", () => {
  /* Story is 1080 wide and gives 172 of it back to the button column, so the
     band has roughly 750px minus the page margin. A loadout at the landscape
     unit size came out 832px and overflowed — that is the regression these
     sizes were solved backwards from. */
  const usable = CANVAS_SIZE.story.width - 172 - 84;
  for (const mode of ["perks", "loadout", "all"] as Mode[]) {
    const pieces = mode === "perks" ? perks(4) : mode === "loadout" ? loadout() : [...perks(4), ...loadout()];
    const l = layoutFor("story", mode, pieces);
    assert.ok(
      l.bandWidth <= usable,
      `story/${mode}: band is ${l.bandWidth}px, only ${usable}px is usable`,
    );
  }
});

test("story wraps perks at two per row, landscape at four", () => {
  assert.equal(layoutFor("story", "perks", perks(4)).perRow, 2);
  assert.equal(layoutFor("landscape", "perks", perks(4)).perRow, 4);
});

test("a story build of one or two perks does not wrap at all", () => {
  assert.equal(layoutFor("story", "perks", perks(1)).perRow, 1);
  assert.equal(layoutFor("story", "perks", perks(2)).perRow, 2);
});

/* ---------------------------------------------------------------- */
/* Slot groups                                                        */
/* ---------------------------------------------------------------- */

test("the loadout is grouped the way the game groups it", () => {
  const l = layoutFor("landscape", "loadout", loadout());
  assert.deepEqual(
    l.slotGroups.map((g) => g.label.en),
    ["Item", "Add-ons", "Offering"],
  );
  assert.deepEqual(
    l.slotGroups.map((g) => g.big),
    [true, false, true],
    "add-ons are the small slot; item and offering are drawn large",
  );
});

test("an empty group is dropped rather than left as a gap", () => {
  const l = layoutFor("landscape", "loadout", [piece("item", 0)]);
  assert.deepEqual(
    l.slotGroups.map((g) => g.label.en),
    ["Item"],
  );
});

test("a killer's Power takes the Item slot, and only outside perks mode", () => {
  const withPower = shareCardLayout({
    layout: "landscape",
    mode: "loadout",
    role: "killer",
    language: "en",
    pieces: loadout(),
    character: "Trapper",
    title: "The Trapper",
  });
  const labels = withPower.slotGroups.map((g) => g.label.en);
  assert.ok(labels.includes("Power"), `expected a Power slot, got ${labels.join(", ")}`);
  assert.equal(labels[0], "Power", "the Power leads the row, as the site shows it");

  const perksOnly = shareCardLayout({
    layout: "landscape",
    mode: "perks",
    role: "killer",
    language: "en",
    pieces: perks(4),
    character: "Trapper",
    title: "The Trapper",
  });
  assert.equal(perksOnly.hasLoadout, false, "a perks roll shows no loadout, Power included");
});

test("perkPieces are the ones with no kind", () => {
  const l = layoutFor("landscape", "all", [...perks(4), ...loadout()]);
  assert.equal(l.perkPieces.length, 4);
  assert.ok(l.hasLoadout);
});

/* ---------------------------------------------------------------- */
/* The heading                                                        */
/* ---------------------------------------------------------------- */

test("perks mode counts them, in both languages, with Russian plurals", () => {
  const en = (n: number) =>
    shareCardLayout({
      layout: "landscape", mode: "perks", role: "survivor", language: "en",
      pieces: perks(n), title: "t",
    }).bandLabel;
  const ru = (n: number) =>
    shareCardLayout({
      layout: "landscape", mode: "perks", role: "survivor", language: "ru",
      pieces: perks(n), title: "t",
    }).bandLabel;

  assert.equal(en(1), "1 perk");
  assert.equal(en(4), "4 perks");
  assert.equal(ru(1), "1 перк");
  assert.equal(ru(2), "2 перка");
  assert.equal(ru(5), "5 перков");
});

test("the other modes name themselves rather than counting", () => {
  assert.equal(layoutFor("landscape", "loadout", loadout()).bandLabel, "Loadout");
  assert.equal(layoutFor("landscape", "all", [...perks(4), ...loadout()]).bandLabel, "Perks & loadout");
});

/* ---------------------------------------------------------------- */
/* The landscape portrait composition                                 */
/* ---------------------------------------------------------------- */

test("the band is centred in the room the figure leaves", () => {
  const l = layoutFor("landscape", "perks", perks(4), { character: "Meg" });
  const { bandLeft } = landscapePortraitLayout(l);
  assert.ok(bandLeft > l.portraitRight, "the band must clear the figure");
  assert.ok(bandLeft + l.bandWidth <= l.width - l.margin, "the band runs off the right edge");
});

test("a long unbreakable name shrinks; a short one does not", () => {
  /* A two-word name wraps. "Демогоргон" has nowhere to break and simply ran
     past the cap — which is what the per-character factor is for. */
  const short = landscapePortraitLayout(
    layoutFor("landscape", "perks", perks(4), { character: "Meg", title: "Meg" }),
  ).nameSize;
  const long = landscapePortraitLayout(
    layoutFor("landscape", "perks", perks(4), { character: "Meg", title: "Демогоргон" }),
  ).nameSize;
  assert.ok(long < short, `a long name should shrink: ${long} vs ${short}`);
});

test("the name never shrinks below the floor or past the ceiling", () => {
  for (const title of ["X", "Демогоргон", "Торговка черепами", "A".repeat(40)]) {
    const { nameSize } = landscapePortraitLayout(
      layoutFor("landscape", "perks", perks(4), { character: "Meg", title }),
    );
    assert.ok(nameSize >= 52 && nameSize <= 104, `"${title}" produced ${nameSize}px`);
  }
});

test("the name block is never given negative room", () => {
  // nameMax is derived by subtraction, so a wide band could in principle
  // produce a negative maxWidth and collapse the block entirely.
  for (const mode of ["perks", "loadout", "all"] as Mode[]) {
    const pieces = mode === "perks" ? perks(8) : mode === "loadout" ? loadout() : [...perks(8), ...loadout()];
    const { nameMax } = landscapePortraitLayout(layoutFor("landscape", mode, pieces, { character: "Meg" }));
    assert.ok(nameMax > 0, `${mode}: name block got ${nameMax}px`);
  }
});

/* ---------------------------------------------------------------- */
/* Portrait geometry                                                  */
/* ---------------------------------------------------------------- */

test("the landscape figure is full card height and bleeds off the left", () => {
  const l = layoutFor("landscape", "perks", perks(4), { character: "Meg" });
  assert.equal(l.portraitH, l.height, "cover on a square source must fit the height exactly");
  assert.ok(l.portraitLeft < 0, "the figure bleeds off the left edge");
  assert.ok(l.portraitRight > 0 && l.portraitRight < l.width / 2);
});

test("every layout is one of the two canvas sizes", () => {
  for (const which of ["landscape", "story"] as const) {
    const l = layoutFor(which, "perks", perks(4));
    assert.deepEqual({ width: l.width, height: l.height }, CANVAS_SIZE[which]);
  }
});

/* ---------------------------------------------------------------- */
/* Slot sizing                                                        */
/* ---------------------------------------------------------------- */

test("a slot is wider than its diamond, so the label has room", () => {
  const l = layoutFor("landscape", "perks", perks(4));
  assert.ok(l.slotFor(100) > 100, "the gutter is what buys a label its room");
});

test("all mode gets a bigger gutter than a single-mode card", () => {
  // It packs perks and a loadout into one band, so the names are tighter.
  const all = layoutFor("landscape", "all", [...perks(4), ...loadout()]).slotFor(100);
  const perksOnly = layoutFor("landscape", "perks", perks(4)).slotFor(100);
  assert.ok(all > perksOnly, "all mode needs the extra gutter, not less");
});

test("an empty build still produces a usable layout", () => {
  // Zero perks is a real state — "challenge mode" rolls none.
  const l = layoutFor("landscape", "perks", []);
  assert.equal(l.count, 1, "count is floored at 1 so it can divide");
  assert.ok(l.bandWidth > 0);
  assert.ok(l.perRow >= 1);
});
