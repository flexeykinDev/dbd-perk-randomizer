import { test, expect, type Page } from "@playwright/test";

/* The embed, at the size it will actually be used.
 *
 * Everything here is about the page not owning the viewport. On the full
 * site a stray `fixed` or a 100vh block is a cosmetic problem; inside a
 * 320px frame on somebody else's page it either spills out of the frame or
 * covers their content, and the person who embedded it finds out before we
 * do.
 */

const SMALL = { width: 320, height: 220 };

async function cards(page: Page) {
  return page.locator("main img[alt]").count();
}

test("a full build fits a 320x220 frame with nothing hanging out", async ({ page }) => {
  await page.setViewportSize(SMALL);
  await page.goto("/#/embed");

  await expect.poll(() => cards(page)).toBe(4);

  const overflow = await page.evaluate(() => ({
    horizontal: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.horizontal, JSON.stringify(overflow)).toBe(false);
});

test("nothing is pinned to a viewport the embed does not own", async ({ page }) => {
  await page.setViewportSize(SMALL);
  await page.goto("/#/embed");
  await expect.poll(() => cards(page)).toBe(4);

  const pinned = await page.evaluate(() =>
    [...document.querySelectorAll("body *")]
      .filter((el) => {
        const p = getComputedStyle(el).position;
        return p === "fixed" || p === "sticky";
      })
      .map((el) => el.className.toString().slice(0, 40)),
  );
  expect(pinned).toEqual([]);

  // A scroll lock on the body would freeze the host page around the frame.
  const bodyOverflow = await page.evaluate(() => getComputedStyle(document.body).overflow);
  expect(bodyOverflow).not.toBe("hidden");
});

test("the roll button gives a different build", async ({ page }) => {
  await page.setViewportSize(SMALL);
  await page.goto("/#/embed");
  await expect.poll(() => cards(page)).toBe(4);

  const names = () =>
    page.locator("main img[alt]").evaluateAll((els) => els.map((e) => e.getAttribute("alt")));
  const before = await names();

  // 176 survivor perks makes a repeat of all four vanishingly unlikely, but
  // press a few times rather than once so this cannot flake on a fluke.
  for (let i = 0; i < 3; i++) {
    await page.getByRole("button").first().click();
    if (JSON.stringify(await names()) !== JSON.stringify(before)) return;
  }
  expect(await names()).not.toEqual(before);
});

test("role and size come from the URL", async ({ page }) => {
  await page.setViewportSize({ width: 480, height: 320 });
  await page.goto("/?r=k&n=2#/embed");
  await expect.poll(() => cards(page)).toBe(2);
});

test("a nonsense size falls back to a real build rather than nothing", async ({ page }) => {
  await page.setViewportSize(SMALL);
  await page.goto("/?r=s&n=99#/embed");
  await expect.poll(() => cards(page)).toBe(4);
});

test("the embed never opens a Firebase connection", async ({ page }) => {
  /* The overlay needs a room because OBS runs a separate browser with no
   * shared storage. An embed has no such problem, and opening a realtime
   * connection from a stranger's page for a visitor who never asked is not
   * something to do by accident. */
  const firebase: string[] = [];
  page.on("request", (req) => {
    if (/firebase|firebaseio|firebasedatabase/i.test(req.url())) firebase.push(req.url());
  });

  await page.setViewportSize(SMALL);
  await page.goto("/#/embed");
  await expect.poll(() => cards(page)).toBe(4);
  await page.getByRole("button").first().click();
  await page.waitForTimeout(500);

  expect(firebase).toEqual([]);
});

test("the full site is unaffected by the embed hash existing", async ({ page }) => {
  // The guard is client-side on a static export, so the ordinary page must
  // still be the ordinary page.
  await page.goto("/?r=s");
  await expect.poll(() => page.locator("[data-perk-card]").count()).toBe(4);
  await expect(page.getByRole("button", { name: "Сгенерировать новый билд" })).toBeVisible();
});
