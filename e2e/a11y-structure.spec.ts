import { test, expect, type Page } from "@playwright/test";

/* Document structure a screen reader navigates by, which nothing on screen
 * shows and no other test looks at.
 *
 * Heading level is the one that actually broke: the app went h1 -> h3 with no
 * h2, because the OBS dialog named itself with a styled <p> while the panels
 * inside it used <h3>. Nothing about that is visible — the page looks
 * identical either way — and someone moving through the page by heading
 * lands in a section that claims to be nested under one that does not exist.
 */

/** Every heading actually rendered, in document order, as "H2 Some title". */
async function visibleHeadings(page: Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")]
      .filter((h) => (h as HTMLElement).offsetParent !== null)
      .map((h) => `${h.tagName} ${h.textContent!.trim().slice(0, 40)}`),
  );
}

function expectNoSkippedLevels(headings: string[]) {
  const levels = headings.map((h) => Number(h[1]));
  expect(levels[0], `the page should open at h1, got ${headings[0]}`).toBe(1);
  for (let i = 1; i < levels.length; i++) {
    // Going back up any number of levels is fine; going down more than one at
    // a time is the skip.
    expect(
      levels[i] - levels[i - 1],
      `level skipped at "${headings[i]}" (after "${headings[i - 1]}")`,
    ).toBeLessThanOrEqual(1);
  }
}

test("the board's headings step one level at a time", async ({ page }) => {
  await page.goto("/?role=survivor");
  await expect(page.locator("[data-perk-card]").first()).toBeVisible();
  expectNoSkippedLevels(await visibleHeadings(page));
});

test("the OBS dialog nests under the page rather than skipping a level", async ({ page }) => {
  await page.goto("/?role=survivor");
  await expect(page.locator("[data-perk-card]").first()).toBeVisible();
  await page.getByRole("button", { name: "Оверлей OBS" }).click();

  // This dialog is the only place in the app with h3 section headings, so it
  // is the only place a skip can happen.
  await expect.poll(async () => (await visibleHeadings(page)).length).toBeGreaterThan(3);
  const headings = await visibleHeadings(page);
  expectNoSkippedLevels(headings);
  expect(headings.some((h) => h.startsWith("H3")), "expected the panel headings").toBe(true);
});
