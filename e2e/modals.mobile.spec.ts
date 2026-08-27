import { test, expect, type Page } from "@playwright/test";

/* Every dialog, on a phone, held to the same three rules.
 *
 * The heights had drifted: three dialogs used a shared .modal-card rule
 * measured in dvh, and six used max-h-[85vh]. That difference only shows up
 * on a phone, and only sometimes — 85vh is 85% of the viewport WITHOUT the
 * browser's URL bar, so the bottom of the card, which is where the action
 * button sits, could end up underneath it. They all share the rule now, and
 * this is what stops them drifting apart again.
 */

/** Opens one dialog by clicking its way there from a fresh page. */
const ROUTES: Array<{ name: string; open: (p: Page) => Promise<void> }> = [
  {
    name: "Pool",
    open: async (p) => void (await p.getByRole("button", { name: /^Пул( \d+)?$/ }).first().click()),
  },
  {
    name: "OBS overlay",
    open: async (p) => void (await p.getByRole("button", { name: "Оверлей OBS" }).click()),
  },
  {
    name: "Character picker",
    open: async (p) => void (await p.getByRole("button", { name: /Выбрать персонажа/ }).click()),
  },
  {
    name: "Stats",
    open: async (p) => {
      await p.getByRole("button", { name: "Ещё", exact: true }).click();
      await p.getByRole("button", { name: "Статистика", exact: true }).click();
    },
  },
  {
    name: "History",
    open: async (p) => {
      await p.getByRole("button", { name: "Ещё", exact: true }).click();
      await p.getByRole("button", { name: "История", exact: true }).click();
    },
  },
  {
    name: "Presets",
    open: async (p) => {
      await p.getByRole("button", { name: "Ещё", exact: true }).click();
      await p.getByRole("button", { name: "Готовые билды", exact: true }).click();
    },
  },
  {
    name: "Perk detail",
    open: async (p) => void (await p.locator("[data-perk-card]").first().click()),
  },
];

for (const route of ROUTES) {
  test(`${route.name} fits the phone, and Escape closes it`, async ({ page }) => {
    await page.goto("/?role=survivor&mode=perks");
    await page.waitForSelector("[data-perk-card]");
    await route.open(page);
    await page.waitForTimeout(650);

    const box = await page.evaluate(() => {
      const card = document.querySelector<HTMLElement>(".modal-card");
      if (!card) return null;
      const r = card.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, vh: window.innerHeight };
    });

    // Every dialog shares the height rule — that is the consistency this
    // guards, not just "it happened to fit".
    expect(box, `${route.name} has no .modal-card, so it is not on the shared height rule`).not.toBeNull();

    expect(
      box!.bottom,
      `${route.name} runs ${(box!.bottom - box!.vh).toFixed(0)}px past the bottom of the screen`,
    ).toBeLessThanOrEqual(box!.vh + 1);
    expect(box!.top, `${route.name} starts above the top of the screen`).toBeGreaterThanOrEqual(-1);

    await page.keyboard.press("Escape");
    await expect.poll(() => page.locator(".modal-card").count(), { timeout: 3000 }).toBe(0);
  });
}
