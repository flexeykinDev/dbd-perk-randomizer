import type { Page } from "@playwright/test";

/**
 * Waits until the build on screen has stopped moving.
 *
 * `expect(cards).toHaveCount(4)` is NOT this. It resolves the moment four
 * cards exist in the DOM, which is the start of their entrance, not the end:
 * the cards animate in with a per-slot stagger, so for a few hundred
 * milliseconds they sit at four different scales. Anything measured in that
 * window is measuring the animation.
 *
 * Measured on a Pixel 7 against the static export, the smallest control inside
 * a card is 28px at `toHaveCount(4)` and 40px once the transforms land — so a
 * tap-target spec reading the first number finds sixteen violations that do
 * not exist. It passed for months only because the page was long enough that
 * the assertion happened to start late; shortening the board above the build
 * by 96px was enough to expose it.
 *
 * Use this before reading any geometry — width, height, or position.
 */
export async function buildSettled(page: Page, expected = 4): Promise<void> {
  await page.waitForFunction(
    (n) => {
      const cards = [...document.querySelectorAll("[data-perk-card]")];
      if (cards.length !== n) return false;
      return cards.every((c) => getComputedStyle(c).transform === "none");
    },
    expected,
  );
}
