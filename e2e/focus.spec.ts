import { test, expect, type Page } from "@playwright/test";

/* Space rerolls the build. It stops rerolling the moment focus is sitting on
 * something that treats Space as "activate me" — and after any mouse click
 * that is exactly where focus is.
 *
 * The report: alt-tab out to the game, come back, hit Space to reroll, and a
 * perk description modal opens instead, because the last thing clicked was a
 * perk card and the browser still considers it focused. Same for the Copy
 * buttons. A visitor has no reason to connect "I clicked something earlier"
 * with "my reroll key is dead".
 *
 * Keyboard users must keep the opposite behaviour: if you TAB to a card,
 * Space has to open it. So these check both halves. */

const names = (page: Page) =>
  page.locator("[data-perk-card]").locator("h3, p, span").first();

async function buildSignature(page: Page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll("[data-perk-card] img"))
      .map((i) => (i as HTMLImageElement).src)
      .join("|"),
  );
}

test("Space still rerolls after a perk card was clicked", async ({ page }) => {
  await page.goto("/?role=survivor");
  await expect(page.locator("[data-perk-card]")).toHaveCount(4);

  // Open a card's description the way a mouse user does, then dismiss it.
  await page.locator("[data-perk-card]").first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  const before = await buildSignature(page);
  await page.keyboard.press(" ");
  // The bug: the card is still focused, so Space re-opens its modal.
  await expect(
    page.getByRole("dialog"),
    "Space re-opened the perk modal instead of rerolling",
  ).toHaveCount(0);
  await expect
    .poll(() => buildSignature(page), { timeout: 4000 })
    .not.toBe(before);
});

test("Space still rerolls after a copy button was clicked", async ({ page }) => {
  await page.goto("/?role=survivor");
  await expect(page.locator("[data-perk-card]")).toHaveCount(4);

  await page.getByRole("button", { name: /Скопировать всё/ }).click();
  const before = await buildSignature(page);
  await page.keyboard.press(" ");
  await expect
    .poll(() => buildSignature(page), { timeout: 4000 })
    .not.toBe(before);
});

test("tabbing to a perk card keeps Space as 'open this card'", async ({ page }) => {
  await page.goto("/?role=survivor");
  await expect(page.locator("[data-perk-card]")).toHaveCount(4);

  // Reached by pressing Tab, not by calling .focus() — the distinction is
  // the entire subject of this fix, and a programmatic focus is neither a
  // click nor a keypress, so faking it here would test nothing a real user
  // ever does.
  let reached = false;
  for (let i = 0; i < 40 && !reached; i++) {
    await page.keyboard.press("Tab");
    reached = await page.evaluate(() =>
      Boolean((document.activeElement as HTMLElement)?.closest("[data-perk-card]")),
    );
  }
  expect(reached, "never reached a perk card by tabbing").toBe(true);
  await page.keyboard.press(" ");
  await expect(
    page.getByRole("dialog"),
    "a keyboard user lost the ability to open a focused card with Space",
  ).toBeVisible();
});

void names;
