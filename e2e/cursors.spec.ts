import { test, expect, type Page } from "@playwright/test";

/* Does anything on this site look clickable?
 *
 * Tailwind v4 dropped the v3 preflight rule that gave `button` a pointer
 * cursor. Nothing failed, nothing looked broken in a screenshot, and 41
 * buttons on the main board quietly stopped advertising themselves — the six
 * explicit `cursor-pointer` classes in the codebase were covering for it in
 * six places out of forty-seven.
 *
 * That is exactly the kind of regression a person feels and cannot name, so
 * it is worth a test rather than a one-time fix.
 */
async function cursorsOf(page: Page, selector: string) {
  return page.locator(selector).evaluateAll((els) =>
    (els as HTMLElement[])
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      })
      .map((el) => ({
        cursor: getComputedStyle(el).cursor,
        name: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 40),
      })),
  );
}

test("every enabled control shows it can be clicked", async ({ page }) => {
  await page.goto("/?role=killer&mode=all");
  await expect(page.locator("[data-perk-card]")).toHaveCount(4);

  const controls = await cursorsOf(page, "button:not(:disabled), a[href]");
  expect(controls.length, "expected a boardful of controls to check").toBeGreaterThan(20);

  const blunt = controls.filter((c) => c.cursor !== "pointer");
  expect(
    blunt.map((c) => `${c.name || "(unnamed)"} -> ${c.cursor}`),
    "these controls do not look clickable",
  ).toEqual([]);
});

test("a control that cannot be used says so", async ({ page }) => {
  await page.goto("/?role=killer");
  await expect(page.locator("[data-perk-card]")).toHaveCount(4);
  // The volume slider is the reachable disabled control: muting disables it.
  await page.getByTestId("presentation-picker").click();
  await page.getByRole("menuitemradio", { name: /Слоты/ }).click();
  await page.getByTestId("sound-control").click();
  await page.getByTestId("sound-mute").click();

  const slider = page.getByTestId("sound-volume");
  await expect(slider).toBeDisabled();
  expect(await slider.evaluate((el) => getComputedStyle(el).cursor)).toBe("not-allowed");
});

test("the overlay pieces still advertise that they can be dragged", async ({ page }) => {
  /* The base-layer rules outrank a bare `.cursor-grab` utility on
   * specificity. Sitting them in `@layer base` is what keeps Tailwind's
   * utilities winning — without that, giving every button a pointer would
   * have silently taken `grab` off the draggable overlay pieces. */
  await page.goto("/?role=killer");
  await expect(page.locator("[data-perk-card]")).toHaveCount(4);
  await page.getByRole("button", { name: /Оверлей OBS/ }).click();
  await expect(page.getByRole("dialog")).toBeVisible();

  const grabbable = await page.evaluate(
    () =>
      Array.from(document.querySelectorAll("*")).filter(
        (el) => getComputedStyle(el as HTMLElement).cursor === "grab",
      ).length,
  );
  expect(grabbable, "nothing in the overlay preview offers a grab cursor").toBeGreaterThan(0);
});
