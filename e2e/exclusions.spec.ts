import { test, expect, type Page } from "@playwright/test";
import perks from "../data/perks.json";

/* The three exclusion paths nothing reached.
 *
 * smoke.spec.ts covers toggling one perk, favouriting one, and both surviving
 * a reload. It never uses "Сбросить" or the bulk buttons, and nothing
 * anywhere asserts that picking a build theme actually narrows what gets
 * rolled — dropdown.spec.ts tests that menu's keyboard behaviour, not its
 * effect. All three are code lib/use-exclusions.ts now owns, and all three
 * fail silently: a reset that does nothing, a bulk button that excludes
 * nothing, and a theme filter that quietly rolls from the whole pool are each
 * indistinguishable from working until you count.
 */

const poolButton = (page: Page) => page.getByRole("button", { name: /^Пул( \d+)?$/ });

/** Cards drawn as excluded inside the open pool panel. */
const excludedCards = (page: Page) => page.locator("div.fixed.inset-0 .grayscale");

async function openPool(page: Page) {
  await expect(page.locator("[data-perk-card]").first()).toBeVisible();
  await poolButton(page).click();
  await expect(page.getByText("Настроить пул перков")).toBeVisible();
}

test("Отключить все excludes the whole filtered list, Включить все puts it back", async ({
  page,
}) => {
  await page.goto("/?role=survivor");
  await openPool(page);

  await expect(excludedCards(page)).toHaveCount(0);

  await page.getByRole("button", { name: "Отключить все" }).click();
  // Every survivor perk, so the count is large — the point is that it is the
  // whole list rather than the one card a click would have got.
  await expect.poll(() => excludedCards(page).count()).toBeGreaterThan(100);

  await page.getByRole("button", { name: "Включить все" }).click();
  await expect(excludedCards(page)).toHaveCount(0);
});

test("Сбросить clears the exclusions for the role", async ({ page }) => {
  await page.goto("/?role=survivor");
  await openPool(page);

  const cards = page.locator("div.fixed.inset-0").locator('[role="button"]:has(img)');
  await cards.first().click();
  await cards.nth(1).click();
  await expect(excludedCards(page)).toHaveCount(2);

  await page.getByRole("button", { name: "Сбросить", exact: true }).click();
  await expect(excludedCards(page)).toHaveCount(0);

  // And it really cleared them rather than only repainting: the saved set is
  // what a reload reads back.
  await page.reload();
  await openPool(page);
  await expect(excludedCards(page)).toHaveCount(0);
});

test("a build theme actually narrows what is rolled", async ({ page }) => {
  /* The theme filter is expressed as an exclusion set and merged into the
     same pipeline as manual exclusions, so this asserts the merge happens at
     all — the roll has no idea a theme exists.

     Asserted by NAME against the shipped tag data, not by counting distinct
     perks. A count is not enough: five rolls yield at most twenty perks out
     of 176, so "fewer than half the pool" passes whether the filter works or
     not. Confirmed — that version of this test passed with the filter
     deliberately removed. */
  await page.goto("/?role=survivor");
  await expect(page.locator("[data-perk-card]")).toHaveCount(4);

  const trigger = page.getByRole("button", { name: "Тема билда" });
  await trigger.click();
  const options = page.getByRole("listbox", { name: "Тема билда" }).getByRole("option");
  await expect.poll(() => options.count()).toBeGreaterThan(1);

  // "Аура" — the biggest survivor theme at 66 perks, so a broken filter is
  // still overwhelmingly likely to roll something outside it.
  const themeLabel = "Аура";
  await options.filter({ hasText: themeLabel }).first().click();
  await expect(trigger).toContainText(themeLabel);

  const allowed = new Set(
    (perks as Array<{ role: string; name: { ru: string }; tags?: string[] }>)
      .filter((p) => p.role === "survivor" && (p.tags ?? []).includes("aura"))
      .map((p) => p.name.ru),
  );
  expect(allowed.size).toBeGreaterThan(40);

  const offending: string[] = [];
  for (let i = 0; i < 6; i++) {
    await expect(page.locator("[data-perk-card]")).toHaveCount(4);
    for (const label of await page
      .locator("[data-perk-card]")
      .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") ?? ""))) {
      const name = label.replace(/^[^:]*:\s*/, "").trim();
      if (name && !allowed.has(name)) offending.push(name);
    }
    await page.getByRole("button", { name: /Сгенерировать новый билд/ }).click();
    await page.waitForTimeout(200);
  }

  expect(
    offending,
    `rolled outside the "${themeLabel}" theme: ${[...new Set(offending)].join(", ")}`,
  ).toEqual([]);
});
