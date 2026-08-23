import { test, expect, type Page } from "@playwright/test";

/* What opening a pool manager costs to download.
 *
 * The loadout pool lists roughly 880 pieces, each with its own icon. Rendered
 * eagerly that was 883 images and 18.9 MB the moment the panel opened, against
 * 0.23 MB for the page itself — by far the most expensive thing the site did,
 * and invisible to every other test here because the panel looked and behaved
 * correctly the whole time.
 *
 * Two claims, and the second is what stops the fix from being a regression:
 * opening the panel is cheap, AND scrolling to the bottom still gets you every
 * icon. A broken lazy attribute satisfies the first on its own.
 */
/* The resource-timing buffer holds 250 entries by default and then silently
 * drops the rest — which reported 186 images for a panel that had fetched 883,
 * and made a deliberately broken fix look fine. Raised before any request is
 * made, so the count is the real one. */
async function trackResources(page: Page) {
  await page.addInitScript(() => performance.setResourceTimingBufferSize(20000));
}

/** Image bytes actually transferred, read from the browser's own resource
 *  timings. Summing response bodies undercounted instead — `body()` rejects
 *  for responses already evicted, and the catch swallowed it, reporting
 *  0.06 MB for what turned out to be nearly 4 MB. */
async function imageWeight(page: Page) {
  return page.evaluate(() => {
    const entries = performance.getEntriesByType(
      "resource",
    ) as PerformanceResourceTiming[];
    const images = entries.filter((e) => /\.(webp|png)(\?|$)/.test(e.name));
    return {
      images: images.length,
      bytes: images.reduce((n, e) => n + (e.transferSize || e.encodedBodySize || 0), 0),
    };
  });
}

test("opening the loadout pool does not download the whole icon set", async ({ page }) => {
  await trackResources(page);
  await page.goto("/?role=killer&mode=loadout");
  await expect.poll(() => page.locator("[data-piece-slug]").count()).toBeGreaterThan(2);
  const atLoad = await imageWeight(page);

  await page.getByRole("button", { name: /^Пул( \d+)?$/ }).click();
  await expect(page.getByText("Настроить пул экипировки")).toBeVisible();
  await page.waitForTimeout(3000);

  const opened = await imageWeight(page);
  const rows = await page.locator('div.fixed.inset-0 [role="button"]:has(img)').count();
  const openedMb = (opened.bytes - atLoad.bytes) / 1024 / 1024;
  console.log(
    `rows ${rows} · opening cost ${opened.images - atLoad.images} images, ${openedMb.toFixed(2)} MB`,
  );

  expect(rows, "the panel should still list the whole pool").toBeGreaterThan(400);
  /* Budget, not a target. Eager rendering fetched all 883 icons for 18.9 MB;
   * lazily it fetches what is near the viewport — measured at 186 icons and
   * 3.96 MB, since Chrome's lazy threshold reaches well past the fold. The
   * limits below sit above that and far under the old behaviour, so they
   * catch a regression rather than tracking noise. */
  expect(opened.images - atLoad.images, "the whole icon set was fetched again").toBeLessThan(400);
  expect(openedMb, "opening the pool downloaded far more than the visible rows").toBeLessThan(6);
});

test("scrolling the pool still loads the icons further down", async ({ page }) => {
  await page.goto("/?role=killer&mode=loadout");
  await expect.poll(() => page.locator("[data-piece-slug]").count()).toBeGreaterThan(2);
  await page.getByRole("button", { name: /^Пул( \d+)?$/ }).click();
  await expect(page.getByText("Настроить пул экипировки")).toBeVisible();

  const images = page.locator('div.fixed.inset-0 [role="button"] img');
  const last = images.last();
  await last.scrollIntoViewIfNeeded();
  // naturalWidth is the honest check: a lazy image that never fetched is in
  // the DOM, has its src, is "visible", and is still a blank box.
  await expect
    .poll(
      () => last.evaluate((el) => (el as HTMLImageElement).naturalWidth),
      { timeout: 15000 },
    )
    .toBeGreaterThan(0);
});
