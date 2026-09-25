// The squad card's arithmetic, checked without rendering anything.
//
// Same reasoning as share-card-layout.test.ts: every layout bug the
// single-build card ever shipped was a sum that could have been checked here,
// and the squad card has four rows competing for one canvas instead of one row
// owning it. The thing that must never happen is a row that does not fit —
// silently, in an image somebody has already posted.
import { test } from "node:test";
import assert from "node:assert/strict";
import { squadShareCardLayout } from "./share-card-layout";
import type { ShareCardPiece } from "./share-card-types";

const piece = (slug: string): ShareCardPiece => ({
  slug,
  icon: `/perks/survivor/${slug}.webp`,
  name: { ru: slug, en: slug },
});

const build = (n: number, prefix = "p") =>
  Array.from({ length: n }, (_, i) => piece(`${prefix}${i + 1}`));

const layoutFor = (players: number, perksEach: number, language: "ru" | "en" = "en") =>
  squadShareCardLayout({
    language,
    builds: Array.from({ length: players }, (_, i) => build(perksEach, `pl${i}-`)),
    title: "Random squad",
  });

/** Total vertical space the rows need, the way the card stacks them. */
function rowsHeight(l: ReturnType<typeof squadShareCardLayout>) {
  return l.rows.length * l.rowHeight + l.rowGap * (l.rows.length - 1);
}

test("every lobby size fits the canvas", () => {
  for (const players of [2, 3, 4]) {
    for (const perks of [1, 2, 3, 4]) {
      const l = layoutFor(players, perks);
      assert.equal(l.width, 1600);
      assert.equal(l.height, 900);

      // Rows must fit between the heading and the footer, with the page
      // margins left intact.
      assert.ok(
        rowsHeight(l) + l.margin * 2 <= l.height,
        `${players}x${perks}: rows overflow the card (${rowsHeight(l)} + margins > ${l.height})`,
      );

      // And a row must fit across, or the last player's perk is cropped.
      const rowWidth = perks * l.slotWidth;
      assert.ok(
        rowWidth <= l.width - l.margin * 2,
        `${players}x${perks}: a row is ${rowWidth}px inside ${l.width - l.margin * 2}px`,
      );
    }
  }
});

test("a diamond never exceeds the native icon it is drawn from", () => {
  for (const players of [2, 3, 4]) {
    const l = layoutFor(players, 4);
    assert.ok(l.iconSize <= 256, "upscaling a 256px source only makes it soft");
    assert.ok(l.gem <= 118, "never larger than the single-build card's own perk diamond");
    assert.ok(l.gem >= 54, "smaller than this and the art stops reading");
  }
});

test("more players means smaller diamonds, never a taller card", () => {
  const two = layoutFor(2, 4);
  const four = layoutFor(4, 4);
  assert.ok(four.gem <= two.gem, "four rows must give something back");
  assert.equal(two.height, four.height);
});

test("one row per player, labelled in order and in the right language", () => {
  const ru = layoutFor(3, 4, "ru");
  assert.deepEqual(
    ru.rows.map((r) => r.label),
    ["Игрок 1", "Игрок 2", "Игрок 3"],
  );
  const en = layoutFor(3, 4, "en");
  assert.deepEqual(
    en.rows.map((r) => r.label),
    ["Player 1", "Player 2", "Player 3"],
  );
});

test("the heading counts players, with Russian plurals that agree", () => {
  assert.equal(layoutFor(2, 4, "ru").bandLabel, "2 игрока");
  assert.equal(layoutFor(3, 4, "ru").bandLabel, "3 игрока");
  assert.equal(layoutFor(4, 4, "ru").bandLabel, "4 игрока");
  assert.equal(layoutFor(4, 4, "en").bandLabel, "4 players");
  assert.equal(layoutFor(1, 4, "en").bandLabel, "1 player");
});

test("an uneven squad is sized by its longest build", () => {
  // Player 2 has four perks; nobody may be cropped because the others have
  // fewer.
  const l = squadShareCardLayout({
    language: "en",
    builds: [build(2), build(4), build(1)],
    title: "Random squad",
  });
  assert.ok(4 * l.slotWidth <= l.width - l.margin * 2);
  assert.deepEqual(
    l.rows.map((r) => r.pieces.length),
    [2, 4, 1],
  );
});

test("an empty squad still produces a drawable card", () => {
  const l = squadShareCardLayout({ language: "en", builds: [], title: "Random squad" });
  assert.deepEqual(l.rows, []);
  assert.ok(l.gem >= 54, "no division by zero, no negative geometry");
  assert.ok(Number.isFinite(l.rowHeight));
});
