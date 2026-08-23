import { test, expect, type Page } from "@playwright/test";

/* The overlay itself, which nothing has ever looked at.
 *
 * Its options, its URL and its entrance are all covered. The thing those
 * settings produce is not — and it is the one surface where a broken layout
 * goes out live on someone's stream instead of being noticed and reloaded.
 *
 * The claims here are the ones a streamer would make: the build is actually
 * on screen, the names are readable rather than clipped, nothing spills off
 * the canvas OBS was told to capture, and the background is genuinely
 * transparent so it composites over gameplay.
 */

const CANVAS = { width: 900, height: 300 };

/* Opens the overlay the way a streamer does: roll a build on the site, copy
 * the Browser Source URL out of the OBS dialog, and point something at it.
 *
 * Going straight to `?obs=1#/obs` renders nothing, which is correct — the
 * overlay mirrors a tab and there was no tab. It also made the first version
 * of these tests pass while measuring an empty page: three of the four
 * iterate the pieces they find, and an empty list satisfies every assertion
 * about it. Only the one that counted pieces failed, which is the entire
 * reason it is written that way.
 */
async function openOverlay(page: Page, params = ""): Promise<void> {
  await page.goto("/?role=killer&mode=perks");
  await expect(page.locator("[data-perk-card]")).toHaveCount(4);

  await page.getByRole("button", { name: /Оверлей OBS/ }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  const url = (await page.getByTestId("obs-overlay-url").textContent())?.trim();
  expect(url, "the dialog offered no overlay URL").toBeTruthy();

  // Same context, so the localStorage mirror of the last published build
  // travels with it — see lib/obs-sync.ts.
  await page.setViewportSize(CANVAS);
  const target = new URL(url!);
  await page.goto(`${target.pathname}${target.search}${params}${target.hash}`);
  await expect(page.locator("[data-obs-piece]").first()).toBeVisible({ timeout: 15000 });
}

test("the overlay puts the whole build on screen", async ({ page }) => {
  await openOverlay(page);
  const pieces = page.locator("[data-obs-piece]");
  await expect(pieces).toHaveCount(4);

  for (let i = 0; i < 4; i++) {
    const icon = pieces.nth(i).locator("img").first();
    // naturalWidth, not visibility: an icon that failed to load is still a
    // visible element of the right size and an empty square on stream.
    expect(
      await icon.evaluate((el) => (el as HTMLImageElement).naturalWidth),
      `piece ${i + 1} has no icon`,
    ).toBeGreaterThan(0);
  }
});

test("nothing spills off the canvas OBS was told to capture", async ({ page }) => {
  await openOverlay(page);
  const overflow = await page.evaluate(() => {
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("[data-obs-piece], [data-obs-piece] *"))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.left < -1 || r.top < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1) {
        out.push(
          `${el.tagName.toLowerCase()} "${(el.textContent ?? "").trim().slice(0, 24)}" at ${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}`,
        );
      }
    }
    return out;
  });
  expect(overflow, "content is outside the capture area").toEqual([]);

  // And the page itself must not scroll — a scrollbar in OBS is a black bar.
  const scrolls = await page.evaluate(() => ({
    x: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    y: document.documentElement.scrollHeight > document.documentElement.clientHeight,
  }));
  expect(scrolls, "the overlay page scrolls").toEqual({ x: false, y: false });
});

test("card names are readable rather than clipped", async ({ page }) => {
  await openOverlay(page);
  const clipped = await page.evaluate(() => {
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("[data-obs-piece] *"))) {
      const text = (el.textContent ?? "").trim();
      if (!text || el.children.length > 0) continue;
      /* scrollWidth vs clientWidth, because a bounding box does not grow
       * when text overflows it — the element measures the same whether the
       * name fits or is cut in half. */
      if (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1) {
        out.push(`"${text.slice(0, 30)}" ${el.scrollWidth}x${el.scrollHeight} in ${el.clientWidth}x${el.clientHeight}`);
      }
    }
    return out;
  });
  expect(clipped, "these names do not fit their box").toEqual([]);
});

test("the background is transparent so it composites over gameplay", async ({ page }) => {
  await openOverlay(page);
  /* The default overlay must not paint a ground. A dark background looks
   * fine in a browser tab and is a black rectangle over someone's game. */
  const painted = await page.evaluate(() => {
    const probe = document.createElement("canvas");
    probe.width = probe.height = 1;
    const ctx = probe.getContext("2d")!;
    const alphaOf = (value: string) => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = value;
      ctx.fillRect(0, 0, 1, 1);
      return ctx.getImageData(0, 0, 1, 1).data[3] / 255;
    };
    return {
      html: alphaOf(getComputedStyle(document.documentElement).backgroundColor),
      body: alphaOf(getComputedStyle(document.body).backgroundColor),
    };
  });
  expect(painted.html, "the root paints a background over the game").toBeLessThan(0.02);
  expect(painted.body, "the body paints a background over the game").toBeLessThan(0.02);
});
