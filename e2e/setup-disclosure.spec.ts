import { test, expect } from "@playwright/test";

/* The first visit, which the rest of the suite deliberately does not see.
 *
 * playwright.config.ts seeds every spec as a returning visitor with the
 * setup panel already open, because that is what anyone who has opened it
 * once gets from then on and it keeps a third of the suite from having to
 * click a disclosure before it can reach a control. The consequence is that
 * the collapsed state — the one a stranger actually lands on — would go
 * entirely untested. This is that test.
 */

const TRIGGER = /Персонаж, тема, пулы, оверлей/;
const STORAGE_KEY = "dbd-randomizer:setup-open";

/** A browser that has never been here. */
test.use({ storageState: { cookies: [], origins: [] } });

test("a first visit lands with the setup controls collapsed", async ({ page }) => {
  await page.goto("/?role=survivor");
  await expect(page.locator("[data-perk-card]")).toHaveCount(4);

  const trigger = page.getByRole("button", { name: TRIGGER });
  await expect(trigger).toBeVisible();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");

  // Unmounted, not hidden: a tab stop inside a collapsed panel is a focus
  // trap nobody can see, so these must be absent rather than invisible.
  await expect(page.getByRole("button", { name: "Оверлей OBS" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Выбрать персонажа/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Ещё", exact: true })).toHaveCount(0);
});

test("opening it reveals every control that moved inside", async ({ page }) => {
  await page.goto("/?role=survivor");
  await expect(page.locator("[data-perk-card]")).toHaveCount(4);

  await page.getByRole("button", { name: TRIGGER }).click();

  await expect(page.getByRole("button", { name: TRIGGER })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  for (const name of [
    /^Пул( \d+)?$/,
    "Оверлей OBS",
    /Выбрать персонажа/,
  ] as const) {
    await expect(page.getByRole("button", { name }).first()).toBeVisible();
  }
  await expect(page.getByRole("radiogroup", { name: "Связность билда" })).toBeVisible();
});

test("the choice is remembered, so it is asked for once", async ({ page }) => {
  /* The whole point of persisting it. Someone who opens the panel to pick a
   * character should not have to open it again on their next visit — and
   * someone who never opens it should keep the shorter page. */
  await page.goto("/?role=survivor");
  await expect(page.locator("[data-perk-card]")).toHaveCount(4);
  await page.getByRole("button", { name: TRIGGER }).click();
  await expect(page.getByRole("button", { name: "Оверлей OBS" })).toBeVisible();

  expect(
    await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY),
    "the open state was not written",
  ).toBe("1");

  await page.reload();
  await expect(page.locator("[data-perk-card]")).toHaveCount(4);
  await expect(page.getByRole("button", { name: TRIGGER })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expect(page.getByRole("button", { name: "Оверлей OBS" })).toBeVisible();
});

test("collapsing it again sticks too", async ({ page }) => {
  await page.goto("/?role=survivor");
  await expect(page.locator("[data-perk-card]")).toHaveCount(4);
  const trigger = page.getByRole("button", { name: TRIGGER });

  await trigger.click();
  await trigger.click();

  expect(await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY)).toBe("0");
  await page.reload();
  await expect(page.locator("[data-perk-card]")).toHaveCount(4);
  await expect(page.getByRole("button", { name: TRIGGER })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
});
