import { test, expect, type Page } from "@playwright/test";

/* The export card lays itself out with absolute positions and fixed sizes on
 * a canvas nothing can scroll, so anything that outgrows its slot does not
 * reflow — it prints on top of whatever is underneath. That has happened,
 * separately, five times: a 2x2 grid coming out as 3 + 1, eight pieces in one
 * row of eight, story perk names sitting on the footer, a two-line character
 * name printing through the loadout band, and two Add-on labels running into
 * each other.
 *
 * None of it is visible from a passing render, so this measures the real DOM
 * of the off-screen card in every mode and layout: nothing may cross the
 * footer, leave the card, or overlap a sibling. */

interface Box {
  text: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
  /** How far the text spills past its own slot. A label div stays exactly
   *  `slotWidth` wide no matter how long the name is — the glyphs overflow it
   *  while the box does not grow, so neighbouring boxes never register as
   *  overlapping even when the words visibly run together. Comparing
   *  scrollWidth to clientWidth is what actually sees that. */
  overflow: number;
}

async function measure(page: Page, which: 0 | 1) {
  return page.evaluate((idx) => {
    const host = document.querySelector<HTMLElement>(
      '[aria-hidden="true"][style*="-9999"]',
    );
    if (!host) throw new Error("off-screen share card host not found");
    const card = host.children[idx] as HTMLElement;
    const base = card.getBoundingClientRect();
    const footerEl = card.querySelector<HTMLElement>("[data-share-footer]");
    if (!footerEl) throw new Error("share card footer not found");
    const footerTop = footerEl.getBoundingClientRect().top - base.top;

    // Leaf elements carrying visible text — the things that actually collide.
    const boxes: Box[] = [];
    card.querySelectorAll<HTMLElement>("div").forEach((el) => {
      if (el.closest("[data-share-footer]")) return;
      if (el.children.length > 0) return;
      const text = (el.textContent ?? "").trim();
      if (!text) return;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      boxes.push({
        text: text.slice(0, 30),
        left: Math.round(r.left - base.left),
        top: Math.round(r.top - base.top),
        right: Math.round(r.right - base.left),
        bottom: Math.round(r.bottom - base.top),
        overflow: el.scrollWidth - el.clientWidth,
      });
    });
    return {
      width: Math.round(base.width),
      height: Math.round(base.height),
      footerTop: Math.round(footerTop),
      boxes,
    };
  }, which);
}

/** Two boxes overlap only if they do so on BOTH axes. */
function overlaps(a: Box, b: Box) {
  return (
    a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
  );
}

function check(
  card: Awaited<ReturnType<typeof measure>>,
  label: string,
) {
  for (const box of card.boxes) {
    expect(
      box.overflow,
      `${label}: "${box.text}" is wider than its slot and runs into its neighbour`,
    ).toBeLessThanOrEqual(1);
    expect(
      box.bottom,
      `${label}: "${box.text}" runs into the footer`,
    ).toBeLessThanOrEqual(card.footerTop);
    expect(box.left, `${label}: "${box.text}" is off the left edge`).toBeGreaterThanOrEqual(0);
    expect(box.right, `${label}: "${box.text}" is off the right edge`).toBeLessThanOrEqual(card.width);
    expect(box.top, `${label}: "${box.text}" is off the top edge`).toBeGreaterThanOrEqual(0);
  }
  for (let i = 0; i < card.boxes.length; i++) {
    for (let j = i + 1; j < card.boxes.length; j++) {
      const a = card.boxes[i];
      const b = card.boxes[j];
      expect(
        overlaps(a, b),
        `${label}: "${a.text}" overlaps "${b.text}"`,
      ).toBe(false);
    }
  }
}

const CASES = [
  { url: "/?role=killer&mode=loadout", ready: "power", label: "killer loadout" },
  { url: "/?role=killer&mode=all", ready: "power", label: "killer all" },
  { url: "/?role=killer&mode=perks", ready: "perk", label: "killer perks" },
  { url: "/?role=survivor&mode=loadout", ready: "item", label: "survivor loadout" },
  { url: "/?role=survivor&mode=all", ready: "perk", label: "survivor all" },
  { url: "/?role=survivor&mode=perks", ready: "perk", label: "survivor perks" },
] as const;

for (const c of CASES) {
  test(`export card fits: ${c.label}`, async ({ page }) => {
    await page.goto(c.url);
    if (c.ready === "perk") {
      await expect(page.locator("[data-perk-card]").first()).toBeVisible();
    } else {
      await expect(page.getByTestId(`loadout-slot-${c.ready}`)).toBeVisible();
    }
    // Each load rolls a random build, so one sample proves very little: the
    // names that break a layout are the long ones, and most rolls are short.
    // Reroll and re-measure so a run covers a spread of real names.
    for (let roll = 0; roll < 6; roll++) {
      check(await measure(page, 0), `${c.label} landscape (roll ${roll})`);
      check(await measure(page, 1), `${c.label} story (roll ${roll})`);
      await page.getByRole("button", { name: "Сгенерировать новый билд" }).click();
      await page.waitForTimeout(120);
    }
  });
}
