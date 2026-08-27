import { test, expect, type Page } from "@playwright/test";
import perks from "../data/perks.json";

/* The overlay's Vortex and Slots skins.
 *
 * The load-bearing test here is the first one. This overlay is a URL somebody
 * has already pasted into an OBS scene and may not touch again for months —
 * so the thing that actually matters is that a link with no skin params
 * renders exactly what it rendered before skins existed. Everything after it
 * is the new behaviour.
 */

const STORAGE_KEY = "dbd-randomizer:obs-last-state";

const build = () => {
  const four = (perks as Array<{ slug: string; role: string; name: { en: string; ru: string }; icon: string }>)
    .filter((p) => p.role === "killer")
    .slice(0, 4)
    .map((p) => ({ slug: p.slug, name: p.name, icon: p.icon }));
  return { role: "killer", language: "ru", mode: "perks", character: null, perks: four };
};

async function openOverlay(page: Page, query = "") {
  await page.addInitScript(
    ([key, state]) => localStorage.setItem(key as string, JSON.stringify(state)),
    [STORAGE_KEY, build()] as const,
  );
  await page.goto(`/?obs=1${query}`);
  await expect(page.locator(".obs-overlay-root")).toBeVisible();
  await expect.poll(() => page.locator(".obs-overlay-root img").count()).toBeGreaterThan(3);
}

/** Whatever the page is actually painting behind the cards. */
async function pageBackground(page: Page) {
  return page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);
}


test("a link with no skin params is exactly what it always was", async ({ page }) => {
  await openOverlay(page);

  // Transparent, so it composites over gameplay — the whole premise.
  const bg = await pageBackground(page);
  expect(["rgba(0, 0, 0, 0)", "transparent"]).toContain(bg);

  // And nothing new is painted behind the cards.
  await expect(page.locator(".fixed.-z-10")).toHaveCount(0);
  await expect(page.locator("canvas")).toHaveCount(0);
});

test("the Vortex skin paints a live canvas behind the cards", async ({ page }) => {
  await openOverlay(page, "&bg=vortex");

  const canvas = page.locator("canvas");
  await expect(canvas).toHaveCount(1);
  // Behind the cards, not over them.
  await expect(canvas).toHaveClass(/-z-10/);

  // A canvas that got no context would still be in the DOM, so check it drew.
  const painted = await canvas.evaluate((c: HTMLCanvasElement) => {
    const gl = c.getContext("webgl");
    if (!gl || gl.isContextLost()) return "no-context";
    return c.width > 0 && c.height > 0 ? "sized" : "zero";
  });
  expect(painted).toBe("sized");
});

test("the still Vortex draws a picture instead of a canvas", async ({ page }) => {
  await openOverlay(page, "&bg=vortex&fx=still");

  await expect(page.locator("canvas")).toHaveCount(0);
  const still = page.locator('.fixed.-z-10 img[src^="data:image"]');
  await expect(still).toHaveCount(1);
});

test("the Slots skin paints its cabinet, with no canvas at all", async ({ page }) => {
  await openOverlay(page, "&bg=slots");
  await expect(page.locator("canvas")).toHaveCount(0);
  await expect(page.locator(".fixed.-z-10")).toHaveCount(1);
});

test("background and frame are independent", async ({ page }) => {
  /* The point of two toggles rather than one "theme". A frame with no skin
     has to work, or the pair is really one setting wearing two hats. */
  await openOverlay(page, "&frame=ritual");
  await expect(page.locator(".fixed.-z-10")).toHaveCount(0);
  expect(["rgba(0, 0, 0, 0)", "transparent"]).toContain(await pageBackground(page));

  // The frame replaces the default plate rather than nesting inside it.
  await expect(page.locator(".obs-overlay-root .bg-black\\/55").first()).toHaveCount(0);
});

test("a framed card still shows every perk", async ({ page }) => {
  // A frame that swallowed a card would be caught nowhere else — the overlay
  // has no other assertion that the count survives a skin.
  await openOverlay(page, "&bg=slots&frame=slots");
  const icons = page.locator(".obs-overlay-root img");
  await expect.poll(() => icons.count()).toBe(4);
});

test("an unknown skin falls back rather than rendering nothing", async ({ page }) => {
  // These are URL params a streamer types by hand, or that survive from an
  // older build of the site. A typo must not produce an empty overlay.
  await openOverlay(page, "&bg=nonsense&frame=nonsense&fx=nonsense");
  await expect(page.locator(".fixed.-z-10")).toHaveCount(0);
  await expect.poll(() => page.locator(".obs-overlay-root img").count()).toBe(4);
});
