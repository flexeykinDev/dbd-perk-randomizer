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

    // Regenerating updates the shareable URL query string.
    await page.getByRole("button", { name: "Сгенерировать новый билд" }).click();
    await expect(page).toHaveURL(/[?&]role=killer&perks=/);
  });

  test("exclude panel toggles a perk and persists to localStorage", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /Настроить пул/ }).click();

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
    await expect(page.getByText("Нетерпимость")).toBeVisible();
    await expect(page.getByText("Розыгрыш")).toBeVisible();
  });

  test("perk info modal shows a character portrait", async ({ page }) => {
    await page.goto("/?role=survivor&perks=pharmacy");
    await page.getByRole("button", { name: "Описание: Аптекарь" }).click();
    await expect(page.getByText("Персонаж")).toBeVisible();
    await expect(page.getByText("Quentin", { exact: true })).toBeVisible();
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
