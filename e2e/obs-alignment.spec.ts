import { test, expect } from "@playwright/test";

/* The overlay's cards have to sit on a regular grid, whatever names rolled.
 *
 * They did not. The name pill only had a max-width, so each card was as wide
 * as whatever name it drew — which put the icons at irregular intervals and
 * dragged the icon row's own centre off the middle of the overlay by up to
 * 34px depending purely on the roll. Each card was internally centred the
 * whole time, which is why it read as a text-centring problem and was not one.
 *
 * Measured on the ICONS, because they are what a viewer reads as "the build";
 * the name is a label under them.
 */

const KEY = "dbd-randomizer:obs-last-state";

const withNames = (names: string[]) => ({
  role: "survivor",
  language: "ru",
  mode: "perks",
  character: null,
  perks: names.map((n, i) => ({
    slug: `p${i}`,
    name: { ru: n, en: n },
    icon: "/perks/survivor/adrenaline.webp",
  })),
});

const CASES: Array<[string, string[]]> = [
  ["short names", ["Азарт", "Тьма", "Рывок", "Удача"]],
  [
    "one long name among short ones",
    ["Азарт", "Командная работа: общая скрытность", "Адреналин", "Дар: круг исцеления"],
  ],
  [
    "every name long",
    [
      "Командная работа: общая скрытность",
      "Непреклонность духа навсегда",
      "Дар: круг исцеления",
      "Прирождённый лидер отряда",
    ],
  ],
];

for (const [label, names] of CASES) {
  test(`the icons stay evenly spaced and centred — ${label}`, async ({ page }) => {
    await page.addInitScript(
      ([k, s]) => localStorage.setItem(k as string, JSON.stringify(s)),
      [KEY, withNames(names)] as const,
    );
    await page.goto("/?obs=1&names=1");
    await page.waitForSelector("[data-obs-piece]");
    await expect.poll(() => page.locator("[data-obs-piece] img").count()).toBe(4);

    const { gaps, drift } = await page.evaluate(() => {
      const centres = [...document.querySelectorAll<HTMLElement>("[data-obs-piece] img")].map(
        (i) => {
          const r = i.getBoundingClientRect();
          return r.left + r.width / 2;
        },
      );
      const row = document.querySelector(".obs-overlay-root")!.getBoundingClientRect();
      return {
        gaps: centres.slice(1).map((x, i) => x - centres[i]),
        drift: (centres[0] + centres[centres.length - 1]) / 2 - (row.left + row.width / 2),
      };
    });

    // Every gap the same: the icons are on a grid, not wherever their labels
    // happened to leave them.
    const spread = Math.max(...gaps) - Math.min(...gaps);
    expect(spread, `icon gaps vary by ${spread.toFixed(1)}px: ${gaps.map((g) => g.toFixed(0)).join(", ")}`).toBeLessThan(2);

    // And the run of icons is centred on the overlay, so the build does not
    // sit visibly off to one side because of the names it drew.
    expect(Math.abs(drift), `the icon row sits ${drift.toFixed(1)}px off centre`).toBeLessThan(2);
  });
}

test("with names off the row tightens up rather than reserving label room", async ({ page }) => {
  // Equal columns must not mean permanently wide ones — a streamer running
  // without names should get the compact row they always had.
  await page.addInitScript(
    ([k, s]) => localStorage.setItem(k as string, JSON.stringify(s)),
    [KEY, withNames(["Командная работа: общая скрытность", "Азарт", "Адреналин", "Удача"])] as const,
  );
  await page.goto("/?obs=1&names=0");
  await page.waitForSelector("[data-obs-piece]");

  const gaps = await page.evaluate(() => {
    const c = [...document.querySelectorAll<HTMLElement>("[data-obs-piece] img")].map((i) => {
      const r = i.getBoundingClientRect();
      return r.left + r.width / 2;
    });
    return c.slice(1).map((x, i) => x - c[i]);
  });
  for (const g of gaps) {
    expect(g, `a nameless row should be compact, got ${g.toFixed(0)}px between icons`).toBeLessThan(200);
  }
});
