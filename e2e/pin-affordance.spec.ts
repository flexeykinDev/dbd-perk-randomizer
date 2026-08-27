import { test, expect } from "@playwright/test";

/* You should be able to see which perks you held without reading four corners.
 *
 * A pinned slot used to be marked only by a 24px padlock in the card's corner
 * — the code's own comment called it "the only thing on screen saying why this
 * slot stopped changing when you rerolled". The card carries the state too
 * now. This checks that it actually renders differently, because a class that
 * silently stops applying looks exactly like the old behaviour.
 */

/** The ring is drawn as a box-shadow; an unpinned card has none. */
async function ringsOf(page: import("@playwright/test").Page) {
  return page.locator("[data-perk-card]").evaluateAll((els) =>
    els.map((e) => {
      const s = getComputedStyle(e);
      return { shadow: s.boxShadow === "none" ? "" : s.boxShadow };
    }),
  );
}

test("a pinned perk is marked on the card, not just in its corner", async ({ page }) => {
  await page.goto("/?role=survivor&mode=perks");
  await expect(page.locator("[data-perk-card]")).toHaveCount(4);

  const before = await ringsOf(page);
  expect(before.filter((r) => r.shadow).length, "nothing should be ringed before pinning").toBe(0);

  await page.locator("[data-perk-card]").first().hover();
  await page.getByRole("button", { name: "Закрепить перк" }).first().click();
  await page.mouse.move(2, 2);
  await expect
    .poll(async () => (await ringsOf(page)).filter((r) => r.shadow).length)
    .toBe(1);

  // And it survives a reroll, which is the moment the mark exists for: the
  // build changes around it and you need to see what stayed.
  await page.getByRole("button", { name: /Сгенерировать новый билд/ }).click();
  await page.mouse.move(2, 2);
  await expect
    .poll(async () => (await ringsOf(page)).filter((r) => r.shadow).length, { timeout: 4000 })
    .toBe(1);

  await page.getByRole("button", { name: "Открепить перк" }).click();
  await page.mouse.move(2, 2);
  await expect.poll(async () => (await ringsOf(page)).filter((r) => r.shadow).length).toBe(0);
});
