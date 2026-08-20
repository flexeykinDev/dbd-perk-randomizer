// What only goes wrong on a phone.
//
// Until this file existed every test ran at desktop width, so nothing had
// ever exercised the layout most visitors actually get. These are written
// to *find* things rather than to confirm the happy path: horizontal
// overflow, controls too small to hit, modals taller than the screen,
// text that collides with itself. The functional behaviour — that a perk
// rolls, that a link restores a build — is identical on a phone and is
// covered once, at desktop, in smoke.spec.ts.
import { test, expect, type Page } from "@playwright/test";

/** Apple's and Google's guidance agree on roughly this: anything smaller
 *  is hard to hit reliably with a thumb. Applied to the control's own box,
 *  not its icon. */
const MIN_TAP_TARGET_PX = 40;

/** Nothing may make the page itself scroll sideways. A few pixels of
 *  tolerance because sub-pixel layout rounding is not a bug. */
async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => {
    const doc = document.documentElement;
    return doc.scrollWidth - doc.clientWidth;
  });
}

/** Elements that stick out past the right edge of the viewport — the
 *  cause, when the page scrolls sideways. Returns enough to name them. */
async function offscreenElements(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const out: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>("body *")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.right <= width + 2) continue;
      // The nearest thing to a useful name for a Tailwind-classed div.
      const label =
        el.getAttribute("aria-label") ??
        el.textContent?.trim().slice(0, 30) ??
        el.className?.toString().slice(0, 40);
      out.push(`<${el.tagName.toLowerCase()}> ${label} (right: ${Math.round(r.right)} > ${width})`);
      if (out.length >= 8) break;
    }
    return out;
  });
}

const PAGES = [
  { name: "perks", url: "/?role=survivor" },
  { name: "loadout", url: "/?role=killer&mode=loadout" },
  { name: "all modes", url: "/?role=survivor&mode=all" },
];

for (const { name, url } of PAGES) {
  test(`${name}: the page never scrolls sideways`, async ({ page }) => {
    await page.goto(url);
    await expect(page.locator("main").locator("img[alt]").first()).toBeVisible();

    const overflow = await horizontalOverflow(page);
    if (overflow > 2) {
      console.log(`offenders:\n  ${(await offscreenElements(page)).join("\n  ")}`);
    }
    expect(overflow, "the document is wider than the viewport").toBeLessThanOrEqual(2);
  });
}

test("the primary action is reachable without scrolling to find it", async ({ page }) => {
  await page.goto("/?role=survivor");
  const generate = page.getByRole("button", { name: "Сгенерировать новый билд" });
  await expect(generate).toBeVisible();
  const box = await generate.boundingBox();
  expect(box).not.toBeNull();
  // Comfortably tappable, not a desktop-sized button squeezed onto a phone.
  expect(box!.height).toBeGreaterThanOrEqual(MIN_TAP_TARGET_PX);
});

test("toolbar controls are big enough to hit with a thumb", async ({ page }) => {
  await page.goto("/?role=survivor");
  await expect(page.locator("main").locator("img[alt]").first()).toBeVisible();

  const tooSmall: string[] = [];
  const buttons = await page.getByRole("button").all();
  for (const button of buttons) {
    if (!(await button.isVisible())) continue;
    // Next.js injects its own dev-tools button while running the dev
    // server; it is not part of the site and is absent from a production
    // build, so holding it to the site's standards proves nothing.
    const aria = (await button.getAttribute("aria-label")) ?? "";
    if (aria.startsWith("Open Next.js")) continue;
    const box = await button.boundingBox();
    if (!box) continue;
    if (box.height >= MIN_TAP_TARGET_PX && box.width >= MIN_TAP_TARGET_PX) continue;
    const label = (await button.getAttribute("aria-label")) ?? (await button.innerText()).trim();
    tooSmall.push(`${label || "(unlabelled)"} — ${Math.round(box.width)}x${Math.round(box.height)}`);
  }
  expect(tooSmall, `${tooSmall.length} controls below ${MIN_TAP_TARGET_PX}px`).toEqual([]);
});

test("a modal fits the screen and its close button is reachable", async ({ page }) => {
  await page.goto("/?role=survivor");
  await expect(page.locator("main").locator("img[alt]").first()).toBeVisible();
  await page.getByRole("button", { name: "Пул", exact: true }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  const viewport = page.viewportSize()!;
  const box = (await dialog.boundingBox())!;
  // A dialog taller than the screen is one whose bottom controls cannot be
  // reached — the modals cap themselves at 85-90vh for exactly this reason.
  expect(box.height, "the dialog is taller than the screen").toBeLessThanOrEqual(viewport.height);
  expect(box.width, "the dialog is wider than the screen").toBeLessThanOrEqual(viewport.width);

  // And the way out is on screen without hunting for it.
  const close = dialog.getByRole("button", { name: "Закрыть" }).first();
  await expect(close).toBeInViewport();
});

test("the perk grid stacks instead of squeezing four across", async ({ page }) => {
  await page.goto("/?role=survivor");
  const cards = page.locator("[data-perk-card]");
  await expect(cards.first()).toBeVisible();

  const boxes = await Promise.all((await cards.all()).map((c) => c.boundingBox()));
  const tops = new Set(boxes.filter(Boolean).map((b) => Math.round(b!.y / 10)));
  // Four cards on one row at phone width would leave each around 80px —
  // the layout is meant to go two-by-two, which means more than one row.
  expect(tops.size, "all four perk cards sit on a single row").toBeGreaterThan(1);
});

test("opening a card's description is readable rather than clipped", async ({ page }) => {
  await page.goto("/?role=survivor&perks=pharmacy");
  await page.getByRole("button", { name: "Описание: Аптекарь" }).first().click();

  const modal = page.locator(".modal-card");
  await expect(modal).toBeVisible();
  const viewport = page.viewportSize()!;
  const box = (await modal.boundingBox())!;
  expect(box.height).toBeLessThanOrEqual(viewport.height);
  // The description itself has to be on screen, not pushed below the fold
  // by the header.
  await expect(modal.getByRole("listitem").first()).toBeInViewport();
});
