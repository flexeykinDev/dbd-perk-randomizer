import { test, expect, type Page } from "@playwright/test";

/** Same route into the Ritual stage the presentation suite uses. */
async function chooseRitual(page: Page) {
  await page.getByTestId("presentation-picker").click();
  await page.getByRole("menuitemradio", { name: /Ритуал/ }).click();
}

/* The Phase 1 hardening, verified in a real browser.
 *
 * Every one of these is a thing that either produces no visible output when
 * it works (the live region), or only happens under conditions that do not
 * occur on demand (a lost GPU context, a render that throws). None of them
 * can be checked by reading the source, and none of them would be noticed if
 * they silently stopped working — which is the same shape as the bug that
 * started all of this.
 */

test("a screen reader is told what was rolled", async ({ page }) => {
  await page.goto("/?role=survivor&mode=perks");

  const live = page.locator('[aria-live="polite"][aria-atomic="true"]');
  await expect(live).toHaveCount(1);

  // Empty on arrival: a live region with content at mount is announced over
  // the top of the page load, which is worse than saying nothing.
  await expect(live).toHaveText("");

  await expect.poll(() => page.locator("[data-perk-card]").count()).toBe(4);

  await page.getByRole("button", { name: /Сгенерировать|Generate/ }).click();

  // The announcement names the build. Poll rather than wait a fixed time:
  // the region fills on the same render as the cards.
  await expect.poll(async () => (await live.textContent())?.length ?? 0).toBeGreaterThan(10);
  const announced = (await live.textContent())!;
  expect(announced).toMatch(/Новый билд|New build/);

  /* And it names THIS build, not a stale one. Read off the cards' accessible
     names, the way e2e/presentation.spec.ts does — a card's innerText opens
     with the "1".."4" hotkey badge rather than the perk.

     Waits for the count to settle first: AnimatePresence keeps the outgoing
     cards mounted through their exit transition, so straight after a roll the
     board briefly holds both builds. */
  await expect.poll(() => page.locator("[data-perk-card]").count()).toBe(4);
  const shown = (
    await page
      .locator("[data-perk-card]")
      .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") ?? ""))
  ).map((l) => l.replace(/^[^:]*:\s*/, "").trim());
  expect(shown, "no card names to check the announcement against").toHaveLength(4);
  for (const name of shown) {
    expect(announced, `"${name}" is on the board but not in the announcement`).toContain(name);
  }
});

/** The transforms on the four perk cards, sampled as soon as they exist. */
async function cardTransforms(page: Page) {
  return page
    .locator("[data-perk-card]")
    .evaluateAll((els) => els.map((e) => getComputedStyle(e).transform));
}

const IDENTITY = /^(none|matrix\(1, 0, 0, 1, 0, 0\))$/;

test("reduce-motion is honoured outside the canvas stages too", async ({ page }) => {
  /* The two stages read the media query themselves; roughly a dozen Framer
     Motion components did not, so modals, panels, toasts and the card reveal
     springs all moved regardless of the setting (WCAG 2.2 §2.3.3). The fix is
     MotionConfig reducedMotion="user" at the root, which the cards below are
     the most visible consumer of.

     Asserted on the cards' computed transform: `reducedMotion` keeps opacity
     transitions and drops transform ones, so a reduced-motion card is at its
     final position from the first frame while an animating one is mid-spring
     — scaled to 0.62 and rotated. */
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/?role=survivor&mode=perks");
  await expect.poll(() => page.locator("[data-perk-card]").count()).toBe(4);

  // Sampled repeatedly through the window the spring would occupy, so this
  // cannot pass by simply looking after the animation would have ended.
  for (let i = 0; i < 6; i++) {
    for (const t of await cardTransforms(page)) {
      expect(t, "a card is being transformed despite reduce-motion").toMatch(IDENTITY);
    }
    await page.waitForTimeout(60);
  }
});

test("without reduce-motion the cards still animate", async ({ page }) => {
  /* The other half of the pair. Without this, the test above would still pass
     if the cards simply stopped animating for everyone — which would be a
     regression, not a fix. */
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/?role=survivor&mode=perks");
  await expect.poll(() => page.locator("[data-perk-card]").count()).toBe(4);

  let sawMotion = false;
  for (let i = 0; i < 8 && !sawMotion; i++) {
    sawMotion = (await cardTransforms(page)).some((t) => !IDENTITY.test(t));
    if (!sawMotion) await page.waitForTimeout(40);
  }
  expect(sawMotion, "the reveal animation is gone for everyone, not just reduce-motion").toBe(
    true,
  );
});

test("a lost GPU context does not leave a dead canvas", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  /* readPixels reads the drawing buffer, which the browser is free to discard
     the moment it has composited the frame — without this the readback below
     returns whatever happens to be left and proves nothing. Forced here at
     context creation rather than in the component: the app has no reason to
     pay for a preserved buffer in production. */
  await page.addInitScript(() => {
    const real = HTMLCanvasElement.prototype.getContext;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: any[]) {
      if (args[0] === "webgl") args[1] = { ...(args[1] ?? {}), preserveDrawingBuffer: true };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (real as any).apply(this, args);
    };
  });

  await page.goto("/?role=killer&mode=perks");
  await chooseRitual(page);
  const stage = page.locator('[data-testid="ritual-stage"]');
  await expect(stage).toBeVisible();

  const fog = stage.locator("canvas").first();
  await expect(fog).toBeVisible();

  /* Take the context away the way a driver reset would, and watch for the
     events themselves — `restored` firing at all is the thing the fix buys.
     Without preventDefault on `lost`, the browser never fires it and the
     canvas is dead for the life of the page.

     One extension object throughout: getExtension hands back a fresh wrapper
     each call, and restoreContext only undoes a loss caused by the same one. */
  const lost = await fog.evaluate((c: HTMLCanvasElement) => {
    const w = window as unknown as { __ext?: WEBGL_lose_context; __ev?: string[] };
    const gl = c.getContext("webgl");
    const ext = gl?.getExtension("WEBGL_lose_context");
    if (!ext) return "no-extension";
    w.__ext = ext;
    w.__ev = [];
    c.addEventListener("webglcontextlost", () => w.__ev!.push("lost"));
    c.addEventListener("webglcontextrestored", () => w.__ev!.push("restored"));
    ext.loseContext();
    return "lost";
  });
  test.skip(lost === "no-extension", "WEBGL_lose_context unavailable in this browser");

  // The stage survives the loss: the cards keep rendering on their own 2D
  // canvas rather than the whole thing freezing or throwing.
  await page.waitForTimeout(300);
  await expect(stage).toBeVisible();
  expect(errors, `page threw while the GL context was gone: ${errors.join("; ")}`).toEqual([]);

  const restored = await fog.evaluate(async (c: HTMLCanvasElement) => {
    const w = window as unknown as { __ext?: WEBGL_lose_context; __ev?: string[] };
    w.__ext!.restoreContext();
    await new Promise((r) => setTimeout(r, 800));
    const gl = c.getContext("webgl");
    return { alive: !!gl && !gl.isContextLost(), events: w.__ev ?? [] };
  });
  expect(restored.events, "the canvas never saw a lost/restored pair").toEqual([
    "lost",
    "restored",
  ]);
  expect(restored.alive, "the GL context never came back").toBe(true);

  /* And the fog is actually painting again. A restored context that nobody
     rebuilt the shaders for is alive and BLANK — which is the whole failure
     this guards, and the thing a liveness check alone cannot see.

     Sampled across the canvas rather than at one pixel: the fog is a
     gradient, so several distinct colours mean it drew, while a cleared
     buffer is one flat colour everywhere. Alpha is useless here — the
     context is created with alpha:false, so it reads 255 whether or not
     anything was drawn. */
  await page.waitForTimeout(500);
  const distinct = await fog.evaluate((c: HTMLCanvasElement) => {
    const gl = c.getContext("webgl");
    if (!gl || gl.isContextLost()) return -1;
    const seen = new Set<string>();
    for (const [x, y] of [
      [0.2, 0.3],
      [0.5, 0.5],
      [0.8, 0.7],
      [0.35, 0.8],
      [0.65, 0.2],
    ] as const) {
      const px = new Uint8Array(4);
      gl.readPixels(
        Math.floor(c.width * x),
        Math.floor(c.height * y),
        1,
        1,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        px,
      );
      seen.add(`${px[0]},${px[1]},${px[2]}`);
    }
    return seen.size;
  });
  expect(distinct, "the context came back but nothing redraws into it").toBeGreaterThan(1);

  expect(errors, `page threw after restore: ${errors.join("; ")}`).toEqual([]);
});

test("a stage that cannot render falls back to the grid instead of a blank page", async ({
  page,
}) => {
  /* Simulates the unrecoverable case: a browser that refuses a canvas
     context outright (a blocklisted driver, or too many live contexts).
     Before the boundary, a throw here unmounted the whole tree and left a
     white page — on a static export there is no server-rendered fallback to
     catch it. */
  await page.addInitScript(() => {
    const real = HTMLCanvasElement.prototype.getContext;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: any[]) {
      if (args[0] === "2d" && this.closest('[data-testid="ritual-stage"]')) {
        throw new Error("simulated: no 2d context available");
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (real as any).apply(this, args);
    };
  });

  await page.goto("/?role=killer&mode=perks");
  await chooseRitual(page);

  // The page is still a working randomizer: the cards are there and the
  // primary action still works.
  await expect.poll(() => page.locator("[data-perk-card]").count(), { timeout: 8000 }).toBe(4);
  await expect(page.getByRole("button", { name: /Сгенерировать|Generate/ })).toBeVisible();
});
