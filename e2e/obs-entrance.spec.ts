import { test, expect } from "@playwright/test";

/* The OBS build-entrance preview.
 *
 * The motion itself comes from entranceMotion, the same function the overlay
 * renders with, so it cannot drift from the real animation. What can still
 * break is the wiring: that hovering a chip changes what is shown, and that
 * it keeps replaying instead of playing once and freezing.
 */

test("the OBS entrance chips preview their animation", async ({ page }) => {
  /* The preview reads its motion from entranceMotion, the same source the
   * overlay uses. What can still break is the wiring: that hovering a chip
   * actually changes what the preview shows, and that it replays rather than
   * animating once and sitting still. */
  await page.goto("/?role=killer");
  await expect(page.locator("[data-perk-card]")).toHaveCount(4);
  await page.getByRole("button", { name: /Оверлей OBS/ }).click();
  await expect(page.getByRole("dialog")).toBeVisible();

  const preview = page.getByTestId("entrance-preview");
  await expect(preview).toBeVisible();
  await expect(preview).toHaveAttribute("data-entrance", "rise");

  await page.getByTestId("obs-entrance-flip").hover();
  await expect(preview).toHaveAttribute("data-entrance", "flip");

  // It has to keep REPLAYING, which is the part worth asserting: settle past
  // the first run so everything is at rest, then require movement again. A
  // preview that animates once and stops passes any check that starts
  // sampling immediately after the hover.
  const cards = preview.locator("span[class*='rounded-md']");
  await expect(cards).toHaveCount(3);
  await page.waitForTimeout(1300);
  let moved = false;
  for (let i = 0; i < 40 && !moved; i++) {
    const transforms = await cards.evaluateAll((els) =>
      els.map((el) => getComputedStyle(el as HTMLElement).transform),
    );
    if (transforms.some((tr) => tr !== "none" && tr !== "matrix(1, 0, 0, 1, 0, 0)")) moved = true;
    await page.waitForTimeout(60);
  }
  expect(moved, "the preview never animated — it is a static row of squares").toBe(true);
});
