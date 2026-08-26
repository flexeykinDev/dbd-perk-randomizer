import { test, expect, type Page } from "@playwright/test";
import perks from "../data/perks.json";

/* The two Battle Royale paths smoke.spec.ts does not reach.
 *
 * That suite covers attrition and the off/on reset, which is the mode's
 * premise. It never reloads the page and never uses "Начать заново" — so
 * session persistence and restart were both uncovered, and both are code
 * lib/use-battle-royale.ts now owns. A broken hydrate is invisible in the
 * worst way: the run silently starts over and the pool looks full again.
 */

/** "Использовано в Battle Royale: 8 · Осталось: 307" → [8, 307]. */
async function attrition(page: Page): Promise<[number, number]> {
  const text = await page
    .getByText("Использовано в Battle Royale:")
    .first()
    .innerText();
  const numbers = text.match(/\d+/g) ?? [];
  return [Number(numbers[0]), Number(numbers[1])];
}

async function startRun(page: Page) {
  await page.goto("/?role=survivor");
  await expect(page.locator("[data-perk-card]").first()).toBeVisible();
  await page.getByRole("switch", { name: "Battle Royale" }).click();
  await page.getByRole("button", { name: "Статистика пула" }).click();
}

test("a run in progress survives a reload", async ({ page }) => {
  await startRun(page);
  await page.getByRole("button", { name: "Сгенерировать новый билд" }).click();
  await expect.poll(() => attrition(page).then(([used]) => used)).toBe(4);

  await page.reload();
  await expect(page.locator("[data-perk-card]").first()).toBeVisible();

  // The mode is still on, and the spent perks are still spent. Session
  // storage, so this holds within the sitting and no further.
  await expect(page.getByRole("switch", { name: "Battle Royale" })).toBeChecked();
  await page.getByRole("button", { name: "Статистика пула" }).click();
  await expect.poll(() => attrition(page).then(([used]) => used)).toBe(4);
});

test("Начать заново refills the pool without leaving the mode", async ({ page }) => {
  /* "Начать заново" only exists once the pool is drained — that is the whole
     point of it — so the run is seeded straight into session storage rather
     than clicking Generate forty-odd times. Same state a real game reaches,
     same key lib/use-battle-royale.ts writes; if that key ever changes, this
     stops finding the button and fails, which is the correct outcome. */
  const survivorSlugs = perks
    .filter((p) => p.role === "survivor")
    .map((p) => p.slug);
  // All but three, so a 4-perk build genuinely cannot be filled.
  const spent = survivorSlugs.slice(0, survivorSlugs.length - 3);

  await page.addInitScript(
    ([key, used]) => {
      sessionStorage.setItem(key as string, JSON.stringify({ active: true, used }));
    },
    ["dbd-randomizer:battle-royale", spent] as const,
  );

  await page.goto("/?role=survivor");
  const restart = page.getByRole("button", { name: "Начать заново" });
  await expect(restart).toBeVisible();

  await restart.click();

  // Back to a full pool, still in Battle Royale — restart is not a way out
  // of the mode, which is what makes it different from toggling off and on.
  await expect(page.locator("[data-perk-card]").first()).toBeVisible();
  await expect(page.getByRole("switch", { name: "Battle Royale" })).toBeChecked();
  await page.getByRole("button", { name: "Статистика пула" }).click();
  await expect.poll(() => attrition(page).then(([used]) => used)).toBe(0);
});
