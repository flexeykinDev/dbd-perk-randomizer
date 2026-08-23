import { test, expect, type Page } from "@playwright/test";

/* Pinning a perk in Ritual used to lose a card.
 *
 * Locking one slot and rerolling takes the partial-swap path — some slots
 * changed, not all — and that path built new mote objects without claiming
 * them, so the next slot in the same reroll could grab the card just dealt
 * as a spare and repoint it. `hand` still held four; the canvas painted
 * three.
 *
 * Asserted on what the draw loop says it painted rather than on the props or
 * the hand, because both of those were perfectly happy while a slot sat
 * empty.
 */
async function chooseRitual(page: Page) {
  await page.getByTestId("presentation-picker").click();
  await page.getByRole("menuitemradio", { name: /Ритуал/ }).click();
  await expect(page.getByTestId("presentation-picker")).toContainText("Ритуал");
}

test("a locked perk still leaves four cards on the table", async ({ page }) => {
  await page.goto("/?role=killer");
  await expect(page.locator("[data-perk-card]")).toHaveCount(4);
  await chooseRitual(page);

  const stage = page.locator("[data-cards]");
  await expect(stage).toHaveAttribute("data-cards", "4", { timeout: 10000 });

  // Lock slot 1, then reroll repeatedly. The bug needed a spare to be taken
  // after a card had been dealt in the same pass, so it wanted more than one
  // changed slot and did not reproduce every single time.
  await page.getByRole("button", { name: /Закрепить|Открепить/ }).first().click();

  for (let i = 0; i < 6; i++) {
    await page.getByRole("button", { name: "Сгенерировать новый билд" }).click();
    // Settle past the swap: an outgoing card is briefly on the table too.
    await page.waitForTimeout(1200);
    await expect(stage, `four cards after reroll ${i + 1} with a slot locked`).toHaveAttribute(
      "data-cards",
      "4",
    );
  }
});
