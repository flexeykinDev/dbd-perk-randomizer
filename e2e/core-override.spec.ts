import { test, expect } from "@playwright/test";
import loadoutOverrides from "../data/overrides/loadout.json";

/* A hand-written Core Effect has to survive all the way to the card.
 *
 * Every loadout override was inert in the UI from the day they were added,
 * and every unit test passed the whole time. They are looked up by
 * `kind:slug`; the description bundle carries only the prose, with no
 * identity; and the modal called getLoadoutPieceDescription(entry) with just
 * that, so the lookup found nothing and the card showed derived text.
 *
 * The unit tests could not have caught it: they composed their own input as
 * { ...piece, ...entry }, which is what the component SHOULD have passed,
 * not what it did. The mistake was in the caller. So this opens real cards
 * and reads what a person sees.
 */
const overrides = loadoutOverrides.entries as Record<string, { ru?: string }>;

test("a hand-written Core Effect reaches the card it belongs to", async ({ page }) => {
  await page.goto("/?role=survivor&mode=loadout");
  await expect.poll(() => page.locator("[data-piece-slug]").count()).toBeGreaterThan(2);

  let checked = 0;
  // Rolls are random, so walk a few builds until enough overridden pieces
  // have been seen. Every loadout piece kind has overrides, so this fills up
  // quickly; the loop bound is only there so a bad build cannot hang it.
  for (let roll = 0; roll < 8 && checked < 3; roll++) {
    const pieces = await page.locator("[data-piece-slug]").evaluateAll((els) =>
      els.map((e) => ({
        kind: e.getAttribute("data-piece-kind"),
        slug: e.getAttribute("data-piece-slug"),
      })),
    );

    for (let i = 0; i < pieces.length && checked < 3; i++) {
      const expected = overrides[`${pieces[i].kind}:${pieces[i].slug}`]?.ru;
      if (!expected) continue;

      await page.locator("[data-piece-slug]").nth(i).click();
      await page.waitForTimeout(450);
      const dialog = page.getByRole("dialog").first();
      const body = (await dialog.innerText()).replace(/\s+/g, " ");
      // The override carries ** highlight markers; the card renders them as
      // styling, so compare against the plain text.
      const plain = expected.replace(/\*\*/g, "");
      expect(
        body,
        `${pieces[i].kind}:${pieces[i].slug} is not showing its hand-written Core Effect`,
      ).toContain(plain);
      checked++;
      await page.keyboard.press("Escape");
      await page.waitForTimeout(250);
    }

    if (checked < 3) {
      await page.getByRole("button", { name: "Сгенерировать новый билд" }).click();
      await page.waitForTimeout(600);
    }
  }

  expect(checked, "no overridden piece was ever rolled — the test proved nothing").toBeGreaterThan(0);
});
