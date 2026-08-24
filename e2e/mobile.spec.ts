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
  // Not just "a card is visible": the board cross-fades, and a card on its
  // way out is mid-transform, so its buttons measure smaller than they will
  // ever actually be drawn. Waiting for exactly the build settles that.
  await expect(page.locator("[data-perk-card]")).toHaveCount(4);

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

test("navigation links are big enough to hit with a thumb", async ({ page }) => {
  // The check above walks buttons only, so every <a> on the page — the nav
  // links, the wordmark, the wiki credit — went unmeasured. They are the
  // controls a visitor hits first.
  await page.goto("/?role=survivor");
  await expect(page.locator("[data-perk-card]")).toHaveCount(4);

  const tooSmall: string[] = [];
  for (const link of await page.getByRole("link").all()) {
    if (!(await link.isVisible())) continue;
    const box = await link.boundingBox();
    if (!box) continue;
    // An inline link inside a running sentence is part of the paragraph, not
    // a control on its own: padding it to 44px would break the line it sits
    // in. Only standalone links are held to the thumb standard.
    const inline = await link.evaluate((el) => {
      const parent = el.parentElement;
      if (!parent) return false;
      const text = (parent.textContent ?? "").trim().length;
      const own = (el.textContent ?? "").trim().length;
      return text > own + 12;
    });
    if (inline) continue;
    if (box.height >= MIN_TAP_TARGET_PX) continue;
    const label = (await link.getAttribute("aria-label")) ?? (await link.innerText()).trim();
    tooSmall.push(`${label || "(unlabelled)"} — ${Math.round(box.width)}x${Math.round(box.height)}`);
  }
  expect(tooSmall, `${tooSmall.length} links below ${MIN_TAP_TARGET_PX}px tall`).toEqual([]);
});

test("a modal fits the screen and its close button is reachable", async ({ page }) => {
  await page.goto("/?role=survivor");
  // Wait for the settled build rather than for the first image: the cards
  // are rendered client-side, so a full set of them is the signal that
  // hydration has finished and the pool button's onClick is actually
  // attached. Clicking it before that does nothing at all, and the dialog
  // below never appears.
  await expect(page.locator("[data-perk-card]")).toHaveCount(4);
  await page.getByRole("button", { name: /^Пул( \d+)?$/ }).click();

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
  // Exactly the build, not the build plus a set of outgoing cards still
  // finishing their cross-fade — with eight cards on screen "more than one
  // row" would be true no matter how the grid is configured.
  await expect(cards).toHaveCount(4);

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

test("no keyboard hint is shown to a device with no keyboard", async ({ page }) => {
  // This row rendered 275x23 on a phone, advertising Space/C/S — keys a
  // touch device cannot press. The digit hints on the reroll buttons are
  // hidden here for the same reason; see the desktop counterpart in
  // smoke.spec.ts, which checks they *are* shown where they work.
  await page.goto("/?role=survivor");
  await expect(page.locator("[data-perk-card]")).toHaveCount(4);

  expect(await page.evaluate(() => matchMedia("(hover: hover)").matches)).toBe(false);

  const visibleKeys: string[] = [];
  const kbd = page.locator("kbd");
  for (let i = 0; i < (await kbd.count()); i++) {
    const key = kbd.nth(i);
    if (await key.isVisible()) visibleKeys.push((await key.innerText()).trim());
  }
  expect(visibleKeys, "keyboard hints on a touch device").toEqual([]);

  const digits = page
    .locator("[data-perk-card]")
    .getByRole("button", { name: "Перебросить этот перк" })
    .locator("span");
  expect(await digits.evaluateAll((els) => els.filter((e) => e.checkVisibility()).length)).toBe(0);
});

test("on a phone, Download Image hands a real image to the share sheet", async ({ page }) => {
  // Reported from an iPhone 17 Pro: the button did nothing, and the toast
  // still said the image had been saved. The old path was an <a download>
  // pointed at a multi-megabyte data: URL — which iOS ignores on both
  // counts — and the success toast fired unconditionally.
  //
  // The share sheet cannot be driven from a test, so it is stubbed here and
  // the assertions are about what the site hands it: a real image file, of
  // non-zero size, named after the build. That is the part this code owns.
  await page.addInitScript(() => {
    const shared: Array<{ name: string; type: string; size: number }> = [];
    (window as unknown as { __shared: typeof shared }).__shared = shared;
    Object.defineProperty(navigator, "canShare", {
      configurable: true,
      value: (data: { files?: File[] }) => Array.isArray(data?.files),
    });
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async (data: { files?: File[] }) => {
        for (const file of data.files ?? [])
          shared.push({ name: file.name, type: file.type, size: file.size });
      },
    });
  });

  await page.goto("/?role=survivor");
  await expect(page.locator("[data-perk-card]")).toHaveCount(4);

  await page.getByRole("button", { name: /Скачать картинку/ }).click();
  await page.getByRole("menuitem", { name: /Стандартный/ }).click();

  await expect
    .poll(
      () => page.evaluate(() => (window as unknown as { __shared: unknown[] }).__shared.length),
      { timeout: 30_000 },
    )
    .toBe(1);

  const [file] = await page.evaluate(
    () => (window as unknown as { __shared: Array<{ name: string; type: string; size: number }> }).__shared,
  );
  expect(file.type).toBe("image/jpeg");
  expect(file.name).toMatch(/^dbd-survivor-build-.+\.jpg$/);
  // A blob that exists but is empty would still "share" — and would still
  // be a broken feature.
  expect(file.size).toBeGreaterThan(10_000);

  // And it must not claim the file was downloaded, because it was not.
  await expect(page.getByText("Картинка билда готова!")).toBeVisible();
  await expect(page.getByText("Картинка билда скачана!")).not.toBeVisible();
});

test("a dismissed share sheet is not reported as a success", async ({ page }) => {
  // Cancelling is a decision, not a failure. Congratulating someone for
  // saving a file they deliberately did not save is how the original bug
  // stayed invisible for so long.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "canShare", {
      configurable: true,
      value: () => true,
    });
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async () => {
        throw Object.assign(new Error("cancelled"), { name: "AbortError" });
      },
    });
  });

  await page.goto("/?role=survivor");
  await expect(page.locator("[data-perk-card]")).toHaveCount(4);
  await page.getByRole("button", { name: /Скачать картинку/ }).click();
  await page.getByRole("menuitem", { name: /Стандартный/ }).click();

  // Sampled rather than checked once at the end: a toast dismisses itself
  // after a few seconds, so "wait, then assert it is gone" passes whether or
  // not it ever appeared. Confirmed — that version of this test survived the
  // mutation that reports a cancelled share as a success.
  const seen = new Set<string>();
  for (let i = 0; i < 60; i++) {
    const text = (await page.locator("body").innerText()).trim();
    for (const toast of [
      "Картинка билда скачана!",
      "Картинка билда готова!",
      "Не удалось создать картинку",
    ])
      if (text.includes(toast)) seen.add(toast);
    await page.waitForTimeout(150);
  }
  expect([...seen], "a dismissed share sheet should say nothing at all").toEqual([]);
});

test("the canvas presentations are offered only where they can run", async ({ page }) => {
  /* Both drive a canvas sized for a wide screen and ask for a keypress; a
   * phone pays the battery for something it has no room to show. The picker
   * still LISTS them — hiding the options entirely would leave a saved
   * desktop choice looking forgotten — but neither can be selected here.
   *
   * Slots used to be selectable, because it was added after the gate was
   * written and never added to it, and this test asserted that as intended.
   * What it actually produced at 430px: a 382x167 stage, reels ~85px wide at
   * roughly 28px per symbol, and every copy/pin/reroll control overflowing
   * the stage by 14px and clipped. Checking only for sideways page overflow
   * missed all of it. */
  await page.goto("/?role=survivor");
  await expect(page.locator("[data-perk-card]")).toHaveCount(4);
  await page.getByTestId("presentation-picker").click();

  for (const name of [/Ритуал/, /Слоты/]) {
    const option = page.getByRole("menuitemradio", { name });
    await expect(option).toBeVisible();
    await expect(option, `${String(name)} is selectable on a phone`).toBeDisabled();
  }

  // And the fallback is a working board, not an empty stage.
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-perk-card]")).toHaveCount(4);
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(2);
});
