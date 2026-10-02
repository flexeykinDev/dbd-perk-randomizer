import { test, expect, type Page } from "@playwright/test";

/* Display QA across everything the site actually lands on: a small phone, a
 * large phone, a tablet, a laptop, a 1080p desktop, a 1440p monitor and a 4K
 * TV. The failures this is looking for are the ones a single desktop viewport
 * cannot show:
 *
 *   - anything wider than the viewport (sideways scroll)
 *   - text too small to read at that distance
 *   - controls too small to hit with a thumb
 *   - a layout that stops using the screen and strands content in a strip
 *
 * Reported, not asserted, where a number is a judgement call — the run prints
 * a table so the numbers can be argued with. Hard failures are reserved for
 * things that are unambiguously broken.
 */

interface Viewport {
  name: string;
  width: number;
  height: number;
  /** Reading distance matters more than pixels: a TV is read from a sofa. */
  minBodyPx: number;
}

const VIEWPORTS: Viewport[] = [
  { name: "phone-small  360x740", width: 360, height: 740, minBodyPx: 12 },
  { name: "phone-large  430x932", width: 430, height: 932, minBodyPx: 12 },
  { name: "tablet       768x1024", width: 768, height: 1024, minBodyPx: 12 },
  { name: "laptop      1366x768", width: 1366, height: 768, minBodyPx: 12 },
  { name: "desktop     1920x1080", width: 1920, height: 1080, minBodyPx: 12 },
  { name: "monitor     2560x1440", width: 2560, height: 1440, minBodyPx: 12 },
  { name: "tv-4k       3840x2160", width: 3840, height: 2160, minBodyPx: 12 },
];

const ROUTES = ["/?role=survivor", "/?role=killer&mode=all", "/?role=killer&mode=loadout"];

async function audit(page: Page, vp: Viewport) {
  return page.evaluate((minBodyPx) => {
    const doc = document.documentElement;
    const overflowers: string[] = [];
    const tiny: string[] = [];
    let widest = 0;

    for (const el of Array.from(document.body.querySelectorAll<HTMLElement>("*"))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.display === "none") continue;
      // Off-screen export cards are not part of the visible page.
      if (el.closest('[aria-hidden="true"][style*="-9999"]')) continue;
      // An element wider than the viewport is fine when an ancestor scrolls
      // it: the slot toolbar deliberately scrolls inside itself rather than
      // wrapping (see the comment above it in randomizer-board.tsx). Only
      // content that pushes the PAGE out of shape is a defect.
      let scrollable = false;
      for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
        const ox = getComputedStyle(n).overflowX;
        if (ox === "auto" || ox === "scroll") {
          scrollable = true;
          break;
        }
      }
      if (scrollable) continue;

      if (r.right > doc.clientWidth + 1 || r.left < -1) {
        widest = Math.max(widest, Math.round(r.right));
        // A DOM path, not just a tag: "div.flex" appears three hundred times.
        const path: string[] = [];
        for (let n: HTMLElement | null = el; n && n !== document.body; n = n.parentElement) {
          const cls =
            typeof n.className === "string" && n.className
              ? "." + n.className.trim().split(/\s+/).slice(0, 3).join(".")
              : "";
          path.unshift(n.tagName.toLowerCase() + cls);
        }
        if (overflowers.length < 4) {
          overflowers.push(
            `right=${Math.round(r.right)} w=${Math.round(r.width)} text="${(el.textContent ?? "").trim().slice(0, 20)}"\n        ${path.slice(-4).join(" > ")}`,
          );
        }
      }

      const text = (el.textContent ?? "").trim();
      if (text && el.children.length === 0) {
        const size = parseFloat(cs.fontSize);
        if (size < minBodyPx && tiny.length < 6) {
          tiny.push(`${Math.round(size)}px "${text.slice(0, 24)}"`);
        }
      }
    }

    /* Tap targets are deliberately NOT measured here. The .tap and
     * .tap-square utilities that give controls their 44px live behind
     * `@media (pointer: coarse)`, and this project is a desktop browser at a
     * phone-sized viewport — the media query does not match, so every control
     * measures at its visual size and the results look alarming and mean
     * nothing. Touch sizing is checked in e2e/mobile.spec.ts, which runs on a
     * device profile that actually reports a coarse pointer. */

    // How much of the screen the page actually uses. A layout that keeps a
    // fixed max-width on a 4K panel leaves most of it empty.
    const main = document.querySelector("main") ?? document.body;
    const used = Math.round(main.getBoundingClientRect().width);

    return {
      scrollW: doc.scrollWidth,
      clientW: doc.clientWidth,
      sideways: doc.scrollWidth > doc.clientWidth + 1,
      overflowers,
      tiny,
      contentWidth: used,
      usedPct: Math.round((used / doc.clientWidth) * 100),
    };
  }, vp.minBodyPx);
}

for (const vp of VIEWPORTS) {
  test(`display: ${vp.name}`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: vp.width, height: vp.height });
    const rows: string[] = [];
    for (const route of ROUTES) {
      await page.goto(route);
      await page
        .locator("[data-perk-card], [data-testid^=loadout-slot]")
        .first()
        .waitFor({ state: "visible" });
      const a = await audit(page, vp);
      rows.push(
        `  ${route.padEnd(30)} content ${String(a.contentWidth).padStart(5)}px (${String(a.usedPct).padStart(3)}% of screen)` +
          `${a.sideways ? `  SIDEWAYS SCROLL ${a.scrollW}>${a.clientW}` : ""}` +
          `${a.overflowers.length ? `\n      overflow: ${a.overflowers.join("; ")}` : ""}` +
          `${a.tiny.length ? `\n      tiny text: ${a.tiny.join("; ")}` : ""}`,
      );
      expect(a.sideways, `${vp.name} ${route}: page scrolls sideways`).toBe(false);
      expect(
        a.overflowers,
        `${vp.name} ${route}: elements reach past the viewport`,
      ).toEqual([]);
    }
    console.log(`\n[${vp.name}]\n${rows.join("\n")}`);
  });
}

/* The canvas presentations were never in this sweep, and they are the part
 * most able to come out too small: they size off their own box rather than
 * off the type scale, so a stage that looks right at 1440 can put four
 * unreadable cards on a phone. Slots is checked everywhere (no desktop gate);
 * Ritual only where it is actually offered. */
for (const vp of VIEWPORTS) {
  test(`stages: ${vp.name}`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto("/?role=killer");
    await page.locator("[data-perk-card]").first().waitFor({ state: "visible" });

    const rows: string[] = [];
    for (const stage of ["Слоты", "Ритуал"] as const) {
      await page.getByTestId("presentation-picker").click();
      const option = page.getByRole("menuitemradio", { name: new RegExp(stage) });
      if (await option.isDisabled()) {
        await page.keyboard.press("Escape");
        rows.push(`  ${stage.padEnd(8)} not offered at this size`);
        continue;
      }
      await option.click();
      const testId = stage === "Слоты" ? "slots-stage" : "ritual-stage";
      const host = page.getByTestId(testId);
      await host.waitFor({ state: "visible" });
      await page.waitForTimeout(1500);

      const box = (await host.boundingBox())!;
      const card = await page.getByRole("button", { name: /^Описание:/ }).first().boundingBox();
      const ctrl = await page.getByRole("button", { name: /^Копировать$/ }).first().boundingBox();
      rows.push(
        `  ${stage.padEnd(8)} stage ${Math.round(box.width)}x${Math.round(box.height)}` +
          `  card ${Math.round(card?.width ?? 0)}x${Math.round(card?.height ?? 0)}` +
          `  control ${Math.round(ctrl?.width ?? 0)}px`,
      );

      const a = await audit(page, vp);
      expect(a.sideways, `${vp.name} ${stage}: page scrolls sideways`).toBe(false);
      expect(a.overflowers, `${vp.name} ${stage}: elements past the viewport`).toEqual([]);
      // Below this a perk is a thumbnail, not a presentation.
      expect(
        card?.width ?? 0,
        `${vp.name} ${stage}: perk card too small to read`,
      ).toBeGreaterThanOrEqual(56);
    }
    console.log(`\n[stages @ ${vp.name}]\n${rows.join("\n")}`);
  });
}

/* How far down the page the build starts.
 *
 * The board used to carry five rows of controls between the heading and the
 * perk cards — role, mode, build size, theme, coherence, character, pools,
 * overlay, More — all in the same pill treatment at the same weight. They
 * are now one primary toolbar plus a single disclosure, and these are the
 * numbers that bought:
 *
 *            first card      Generate
 *   1366x768   397 -> 345     629 -> 589
 *    360x780   795 -> 589    1215 -> 1025
 *
 * Asserted with headroom rather than at the measured value: an exact number
 * fails on a font metric changing by a pixel, which teaches everyone to
 * raise the number instead of looking. These ceilings are set where a
 * regression means a row came back, not where the layout drifted.
 */
/* Re-baselined on 1 Oct, when the type scale was finished. Stepping every
 * control up to 14px cost about 36px at the top of the page — the toolbar
 * rows each grew a little — and the first card went 345 -> 381 on a laptop.
 * That is a real cost and it is written down rather than absorbed: the
 * ceilings move once, with the reason, and a future drift still fails.
 *
 * Still well under a row, which is what these numbers are for. A returning
 * row is ~44px; anything smaller is the layout breathing. */
const BUILD_START_CEILING = [
  { name: "laptop 1366x768", width: 1366, height: 768, maxCardY: 400, maxGenerateY: 640 },
  { name: "phone  360x780", width: 360, height: 780, maxCardY: 680, maxGenerateY: 1120 },
];

for (const vp of BUILD_START_CEILING) {
  test(`the build starts near the top on ${vp.name}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    /* Measured on a FIRST visit, with the setup panel collapsed. The config
     * seeds every other spec as a returning visitor with it open, which is
     * the right default for reaching controls and the wrong one for this:
     * the number that matters is what a stranger lands on. */
    await page.context().addInitScript(() => {
      try {
        localStorage.removeItem("dbd-randomizer:setup-open");
      } catch {
        /* private mode — the panel defaults to collapsed anyway */
      }
    });
    await page.goto("/?role=survivor");
    // The board cross-fades; a card mid-transform measures from where it is
    // animating, not where it lands. Wait for the settled build.
    await expect(page.locator("[data-perk-card]")).toHaveCount(4);
    await expect(
      page.getByRole("button", { name: "Сгенерировать новый билд" }),
    ).toBeVisible();

    const card = await page.locator("[data-perk-card]").first().boundingBox();
    const generate = await page
      .getByRole("button", { name: "Сгенерировать новый билд" })
      .boundingBox();

    expect(card, "no perk card to measure").not.toBeNull();
    expect(generate, "no Generate button to measure").not.toBeNull();
    expect(
      Math.round(card!.y),
      "the first perk card has drifted back down the page",
    ).toBeLessThanOrEqual(vp.maxCardY);
    expect(
      Math.round(generate!.y),
      "Generate has drifted back down the page",
    ).toBeLessThanOrEqual(vp.maxGenerateY);
  });
}

/* The board carries nothing that only a streamer needs.
 *
 * This is the invariant the stream page exists to protect, and it is worth
 * stating because it is easy to undo by accident: one convenience button
 * promoted out of the setup disclosure and every visitor is paying attention
 * for a feature most of them never use.
 *
 * Measured rather than argued: at rest the board shows 44 controls, 16 of
 * which belong to the four perk cards and 6 to the site chrome. None of the
 * rest are OBS, Twitch or overlay controls — those live behind the setup
 * disclosure, and from there behind either a dialog or #/stream.
 */
test("no streamer-only control is on the board at rest", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  // A first visit: the setup disclosure is collapsed, which is where the one
  // way in lives.
  await page.context().addInitScript(() => {
    try {
      localStorage.removeItem("dbd-randomizer:setup-open");
    } catch {
      /* private mode — collapsed is the default anyway */
    }
  });
  await page.goto("/?role=survivor");
  await expect(page.locator("[data-perk-card]")).toHaveCount(4);

  for (const name of [/Оверлей OBS/, /На странице/, /Twitch/i]) {
    await expect(
      page.getByRole("button", { name }).or(page.getByRole("link", { name })),
      `a streamer control is on the board at rest: ${name}`,
    ).toHaveCount(0);
  }
});

test("the stream page shows the whole overlay setup, and the way back", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto("/#/stream");

  // All three tabs, not a subset — splitting the setup across two surfaces
  // is the failure this page was built to avoid.
  await expect(page.getByRole("tab")).toHaveCount(3);
  await expect(page.getByRole("button", { name: /К доске/ })).toBeVisible();

  // And it is a real exit, not a link to a reload that drops the session.
  await page.getByRole("button", { name: /К доске/ }).click();
  await expect(page.locator("[data-perk-card]")).toHaveCount(4);
});

/* The primary action does not move between rolls.
 *
 * The build-theme line under the cards — "3 из 4 перков — про аура-чтение" —
 * appears on roughly 29.5% of rolls at coherence 0 and 77.8% at full synergy,
 * and it used to mount and unmount with the theme it describes. Measured at
 * 1366x768 that put Generate at y=574 on a plain roll and y=616 on a themed
 * one: a 42px jump, on the one control a person presses repeatedly, timed to
 * land exactly while they are pressing it.
 *
 * The slot is always rendered now. This is the assertion that keeps it that
 * way, and it is deliberately run over enough rolls to see both cases — a
 * single roll proves nothing, because most rolls have no theme at all.
 */
test("Generate stays put while rolling", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto("/?role=survivor");

  const generate = page.getByRole("button", { name: "Сгенерировать новый билд" });
  const settled = async () => {
    await page.waitForFunction(() => {
      const cards = [...document.querySelectorAll("[data-perk-card]")];
      return cards.length === 4 && cards.every((c) => getComputedStyle(c).transform === "none");
    });
  };
  await settled();

  /* Read through the DOM rather than with boundingBox(). Playwright scrolls an
     element into view before measuring it and reports viewport coordinates, so
     boundingBox() on a page taller than the window measures the scroll
     position — the first version of this test "failed" with a 439px drift the
     page did not have. */
  const generateY = () =>
    page.evaluate(() => {
      const button = [...document.querySelectorAll("button")].find((b) =>
        /Сгенерировать новый билд/.test(b.textContent ?? ""),
      )!;
      return Math.round(button.getBoundingClientRect().top + window.scrollY);
    });

  const seen = new Set<number>();
  let themed = 0;
  for (let i = 0; i < 14; i++) {
    seen.add(await generateY());
    if (await page.locator("p", { hasText: /перков — про/ }).count()) themed++;
    await generate.click();
    await settled();
  }

  /* Both cases have to have happened, or this passed by never seeing a theme.
     14 rolls at ~29.5% makes a run of zero vanishingly unlikely, but "unlikely"
     is not an assertion. */
  expect(themed, "no themed roll came up, so the jump was never exercised").toBeGreaterThan(0);
  expect(themed, "every roll had a theme, so the plain case was never exercised").toBeLessThan(14);

  const positions = [...seen].sort((a, b) => a - b);
  const drift = positions[positions.length - 1] - positions[0];
  expect(drift, `Generate moved between rolls: y = ${positions.join(", ")}`).toBeLessThanOrEqual(2);
});

/* Nothing below the build moves between rolls.
 *
 * "Generate stays put" above covers the one control that matters most; this is
 * the same promise for everything else, because the complaint that prompted it
 * was "all content jumping like buttons etc" and Generate was only the half of
 * it anyone could name.
 *
 * Two causes, both now fixed and both worth stating so a future change knows
 * what it is up against: the build-theme line mounted and unmounted with the
 * theme it describes (42px, desktop), and on a phone a perk name that wraps to
 * a second line made the two-column grid 20px taller, which moved every
 * control under it on roughly half of all rolls. The first was fixed by always
 * rendering the line's slot, the second by reserving two lines for a card's
 * name below `sm`.
 */
for (const device of [
  { name: "desktop", width: 1366, height: 900 },
  { name: "phone", width: 390, height: 844 },
]) {
  test(`nothing shifts between rolls on ${device.name}`, async ({ page }) => {
    await page.setViewportSize({ width: device.width, height: device.height });
    await page.goto("/?role=survivor");

    const settled = () =>
      page.waitForFunction(() => {
        const cards = [...document.querySelectorAll("[data-perk-card]")];
        return cards.length === 4 && cards.every((c) => getComputedStyle(c).transform === "none");
      });
    await settled();

    /* Document coordinates, not boundingBox(): Playwright scrolls an element
       into view before measuring and reports viewport-relative numbers, which
       measures the scroll rather than the layout. */
    const snapshot = () =>
      page.evaluate(() => {
        const out: Record<string, number> = {};
        for (const el of document.querySelectorAll("button, a, p")) {
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 || el.closest("[data-perk-card]")) continue;
          const key = (el.textContent ?? "").trim().slice(0, 24) || el.tagName;
          out[key] = Math.round(rect.top + window.scrollY);
        }
        return out;
      });

    const runs = [];
    for (let i = 0; i < 10; i++) {
      runs.push(await snapshot());
      await page.getByRole("button", { name: "Сгенерировать новый билд" }).click();
      await settled();
    }

    const moved: string[] = [];
    for (const key of new Set(runs.flatMap((r) => Object.keys(r)))) {
      const seen = runs.map((r) => r[key]).filter((v) => v !== undefined);
      if (seen.length < 2) continue;
      const spread = Math.max(...seen) - Math.min(...seen);
      // A couple of pixels is sub-pixel rounding in the grid, not a shift.
      if (spread > 2) moved.push(`${key} moved ${spread}px`);
    }
    expect(moved, `${moved.length} elements shifted between rolls`).toEqual([]);
  });
}
