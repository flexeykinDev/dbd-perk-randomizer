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
