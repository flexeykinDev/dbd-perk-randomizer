import { test, expect } from "@playwright/test";

test.describe("DBD randomizer", () => {
  test("home page generates a build, toggles role, and updates the share URL", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "Dead by Daylight" }),
    ).toBeVisible();

    const perkGrid = page.locator("main");
    await expect(perkGrid.locator("img[alt]").first()).toBeVisible();

    // Role toggle switches the pool.
    await page.getByRole("button", { name: "Убийца" }).click();
    await expect(page.getByText("Случайный билд для убийцы")).toBeVisible();

    // Regenerating updates the shareable URL query string (compact scheme:
    // r=<role short code>, p=<comma-separated short perk IDs> — see
    // lib/perk-ids.ts / randomizer-board.tsx's syncUrl effect).
    await page.getByRole("button", { name: "Сгенерировать новый билд" }).click();
    await expect(page).toHaveURL(/[?&]r=k&p=\d+(%2C\d+)*/);
  });

  test("exclude panel toggles a perk and persists to localStorage", async ({ page }) => {
    await page.goto("/");
    // exact: true — a fuzzy match also catches "Статистика пула" (Pool stats).
    await page.getByRole("button", { name: "Пул", exact: true }).click();

    const panel = page.getByText("Настроить пул перков");
    await expect(panel).toBeVisible();

    // Perk toggle buttons (unlike "Сбросить"/"Закрыть") contain a perk icon.
    const firstPerkButton = page
      .locator("div.fixed.inset-0")
      .locator("button:has(img)")
      .first();
    await firstPerkButton.click();

    const excludedSlugs = await page.evaluate(() =>
      window.localStorage.getItem("dbd-randomizer:excluded-perks"),
    );
    expect(excludedSlugs).not.toBeNull();
    expect(JSON.parse(excludedSlugs ?? "[]").length).toBeGreaterThan(0);
  });

  test("opening a shared build URL loads that exact build", async ({ page }) => {
    await page.goto(
      "/?role=killer&perks=agitation,bamboozle,brutal-strength,corrupt-intervention",
    );
    // Both names also appear a second time in the off-screen ShareCard used
    // for image export (aria-hidden, but not text-search-hidden) — .first()
    // is the real, visible perk grid card, which renders before it in the
    // DOM. See the "Off-screen" comment in randomizer-board.tsx.
    await expect(page.getByText("Нетерпимость").first()).toBeVisible();
    await expect(page.getByText("Розыгрыш").first()).toBeVisible();
  });

  test("perk info modal shows a character portrait", async ({ page }) => {
    await page.goto("/?role=survivor&perks=pharmacy");
    // The whole card is a role="button" and additionally contains its own
    // small info-icon <button> with the same aria-label — both open the
    // same modal, so either works; .first() is the outer card.
    await page.getByRole("button", { name: "Описание: Аптекарь" }).first().click();
    await expect(page.getByText("Персонаж")).toBeVisible();
    // RU locale (see playwright.config.ts) shows the translated character
    // name, not the English slug — "Квентин", not "Quentin".
    await expect(page.getByText("Квентин", { exact: true })).toBeVisible();
  });
});

test.describe("theme toggle", () => {
  test("switches theme and persists across interaction", async ({ page }) => {
    await page.goto("/");
    const toggle = page.getByRole("button", { name: "Переключить тему" });
    await toggle.click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

    await page.getByRole("button", { name: "Сгенерировать новый билд" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  });
});
