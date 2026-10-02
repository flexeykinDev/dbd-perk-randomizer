import { test, expect } from "@playwright/test";

/* You should be able to see which perks you held without reading four corners.
 *
 * A pinned slot used to be marked only by a 24px padlock in the card's corner
 * — the code's own comment called it "the only thing on screen saying why this
 * slot stopped changing when you rerolled". The card carries the state too
 * now. This checks that it actually renders differently, because a class that
 * silently stops applying looks exactly like the old behaviour.
 */

/** How many cards are marked differently from the rest.
 *
 *  The ring is a box-shadow (Tailwind draws `ring-*` that way), and this used
 *  to count cards that had any box-shadow at all on the grounds that an
 *  unpinned card had none. That stopped being true the moment every card got a
 *  resting shadow for depth, and the test failed while nothing about pinning
 *  had changed.
 *
 *  Counting the odd ones out instead says what the feature actually promises:
 *  a pinned card looks different from the cards beside it. That holds whatever
 *  the base surface does next. */
async function markedCount(page: import("@playwright/test").Page) {
  return page.locator("[data-perk-card]").evaluateAll((els) => {
    const shadows = els.map((e) => getComputedStyle(e).boxShadow);
    const tally = new Map<string, number>();
    for (const s of shadows) tally.set(s, (tally.get(s) ?? 0) + 1);
    // The commonest shadow is the resting one; anything else is a mark.
    let commonest = "";
    let best = -1;
    for (const [shadow, n] of tally) {
      if (n > best) {
        best = n;
        commonest = shadow;
      }
    }
    return shadows.filter((s) => s !== commonest).length;
  });
}

test("a pinned perk is marked on the card, not just in its corner", async ({ page }) => {
  await page.goto("/?role=survivor&mode=perks");
  await expect(page.locator("[data-perk-card]")).toHaveCount(4);

  expect(await markedCount(page), "nothing should be marked before pinning").toBe(0);

  await page.locator("[data-perk-card]").first().hover();
  await page.getByRole("button", { name: "Закрепить перк" }).first().click();
  await page.mouse.move(2, 2);
  await expect
    .poll(async () => await markedCount(page))
    .toBe(1);

  // And it survives a reroll, which is the moment the mark exists for: the
  // build changes around it and you need to see what stayed.
  await page.getByRole("button", { name: /Сгенерировать новый билд/ }).click();
  await page.mouse.move(2, 2);
  await expect
    .poll(async () => await markedCount(page), { timeout: 4000 })
    .toBe(1);

  await page.getByRole("button", { name: "Открепить перк" }).click();
  await page.mouse.move(2, 2);
  await expect.poll(async () => await markedCount(page)).toBe(0);
});
