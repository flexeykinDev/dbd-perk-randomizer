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

    // Perk cards are a div[role="button"] (not a real <button> — they
    // contain their own nested <button> favorite-star toggle, and a real
    // button can't contain another interactive descendant) that wraps a
    // perk icon; unlike "Сбросить"/"Закрыть" or the star toggle itself.
    const firstPerkButton = page
      .locator("div.fixed.inset-0")
      .locator('[role="button"]:has(img)')
      .first();
    await firstPerkButton.click();

    const excludedSlugs = await page.evaluate(() =>
      window.localStorage.getItem("dbd-randomizer:excluded-perks"),
    );
    expect(excludedSlugs).not.toBeNull();
    expect(JSON.parse(excludedSlugs ?? "[]").length).toBeGreaterThan(0);
  });

  test("exclude panel's Close button actually closes it", async ({ page }) => {
    // Regression test: ExcludePanel and CharacterPickerModal both used a
    // bare `key={role}` ("survivor"/"killer") on themselves as siblings in
    // the same parent — React warned about the duplicate key and, in
    // practice, the reconciliation confusion made the Close button stop
    // responding entirely (see randomizer-board.tsx's namespaced
    // `perk-pool-${role}` / `char-picker-${...}` keys).
    await page.goto("/");
    await page.getByRole("button", { name: "Пул", exact: true }).click();
    const panel = page.getByText("Настроить пул перков");
    await expect(panel).toBeVisible();

    await page.getByRole("button", { name: "Закрыть" }).click();
    await expect(panel).not.toBeVisible();
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
    // exact: true — a fuzzy match also catches the "Случайный персонаж"
    // (Random Character) button elsewhere on the page.
    await expect(page.getByText("Персонаж", { exact: true })).toBeVisible();
    // RU locale (see playwright.config.ts) shows the translated character
    // name, not the English slug — "Квентин", not "Quentin".
    await expect(page.getByText("Квентин", { exact: true })).toBeVisible();
  });
});

test.describe("Full Loadout", () => {
  test("switching to loadout mode rolls an item/add-ons/offering HUD", async ({ page }) => {
    await page.goto("/?role=survivor");
    await page.getByRole("button", { name: "Экипировка" }).click();

    await expect(page.getByText("Случайная экипировка для выжившего")).toBeVisible();
    // The in-game-style HUD groups pieces under fixed Item/Add-ons/Offering
    // columns instead of a generic card grid — see loadout-grid.tsx.
    await expect(page.getByTestId("loadout-slot-item")).toBeVisible();
    await expect(page.getByTestId("loadout-slot-addons")).toBeVisible();
    await expect(page.getByTestId("loadout-slot-offering")).toBeVisible();

    // Regenerating updates the shareable URL to the loadout scheme
    // (mode=loadout&lp=<comma-separated short loadout-piece IDs>).
    await page.getByRole("button", { name: "Сгенерировать новый билд" }).click();
    await expect(page).toHaveURL(/[?&]mode=loadout&(?:.*&)?lp=\d+(%2C\d+)*/);
  });

  test("killer loadout shows the rolled killer's Power icon instead of an item", async ({
    page,
  }) => {
    await page.goto("/?role=killer&mode=loadout");
    // Killers don't carry an Item — the Item column is replaced by the
    // Power the rolled add-ons belong to (see the killer-power-icons.json
    // dataset built by scripts/scrape-loadout.ts).
    await expect(page.getByText("Сила", { exact: true })).toBeVisible();
    await expect(page.getByText("Предмет", { exact: true })).not.toBeVisible();
  });

  test("turning off a slot rolls an empty HUD placeholder for it", async ({ page }) => {
    await page.goto("/?role=survivor&mode=loadout");
    await page.getByRole("button", { name: "Подношение", exact: true }).click();

    // The Offering column heading stays (it's a static label), but its slot
    // no longer has a clickable piece card inside — toggling it off also
    // rerolls the other slots (same nonce bump Generate uses), so this
    // can't assert an exact total piece count, only that this one column
    // is specifically empty.
    const offeringSlot = page.getByTestId("loadout-slot-offering");
    await expect(offeringSlot.getByRole("button", { name: /^Описание: /, exact: false })).toHaveCount(
      0,
    );
  });

  test("loadout pool panel excludes a piece and persists to localStorage", async ({ page }) => {
    await page.goto("/?role=survivor&mode=loadout");
    await page.getByRole("button", { name: "Пул", exact: true }).click();

    const panel = page.getByText("Настроить пул экипировки");
    await expect(panel).toBeVisible();

    const firstPieceButton = page
      .locator("div.fixed.inset-0")
      .locator('[role="button"]:has(img)')
      .first();
    await firstPieceButton.click();

    const excludedKeys = await page.evaluate(() =>
      window.localStorage.getItem("dbd-randomizer:excluded-loadout"),
    );
    expect(excludedKeys).not.toBeNull();
    expect(JSON.parse(excludedKeys ?? "[]").length).toBeGreaterThan(0);
  });
});

test.describe("Character picker", () => {
  test("choosing a character shows a portrait chip that can be cleared", async ({ page }) => {
    await page.goto("/?role=survivor");
    const chip = page.getByRole("button", { name: "Убрать персонажа" }).locator("xpath=..");
    await expect(chip).not.toBeVisible();

    await page.getByRole("button", { name: "Выбрать персонажа" }).click();
    // "Random" inside the modal picks and closes in one step, same as
    // clicking any specific portrait would.
    await page.getByRole("button", { name: "Случайный", exact: true }).click();
    await expect(chip).toBeVisible();

    await page.getByRole("button", { name: "Убрать персонажа" }).click();
    await expect(chip).not.toBeVisible();
  });

  test("search filters the grid down to a single portrait to pick", async ({ page }) => {
    await page.goto("/?role=survivor");
    await page.getByRole("button", { name: "Выбрать персонажа" }).click();

    await page.getByPlaceholder("Поиск персонажа…").fill("Дуайт");
    // Not exact: the button's accessible name combines the portrait's alt
    // text with the visible caption span, both "Дуайт".
    await page.getByRole("button", { name: "Дуайт" }).click();

    const chip = page.getByRole("button", { name: "Убрать персонажа" }).locator("xpath=..");
    await expect(chip).toContainText("Дуайт");
  });

  test("guarantee-teachables toggle only shows in Perks mode with a character selected", async ({
    page,
  }) => {
    await page.goto("/?role=survivor");
    const toggle = page.getByRole("switch", { name: "Гарантировать тичеблы" });
    await expect(toggle).not.toBeVisible();

    await page.getByRole("button", { name: "Выбрать персонажа" }).click();
    await page.getByRole("button", { name: "Случайный", exact: true }).click();
    await expect(toggle).toBeVisible();

    // Loadout mode has no "teachable perks" concept — forcing the killer
    // character (see the next test) is what the picker does there instead,
    // so the toggle should disappear rather than sit around inert.
    await page.getByRole("button", { name: "Экипировка" }).click();
    await expect(toggle).not.toBeVisible();
  });

  test("picking a character in killer loadout mode decides the rolled Power", async ({ page }) => {
    await page.goto("/?role=killer&mode=loadout");
    await page.getByRole("button", { name: "Выбрать персонажа" }).click();
    await page.getByRole("button", { name: "Случайный", exact: true }).click();

    // The chip is [portrait span, name span, clear button] — the name is
    // always the last <span> regardless of whether the portrait rendered
    // an <img> or its own fallback "?" <span>.
    const chipName = await page
      .getByRole("button", { name: "Убрать персонажа" })
      .locator("xpath=..")
      .locator("span")
      .last()
      .textContent();
    const powerCaption = page.getByTestId("loadout-slot-power").locator("span").last();
    await expect(powerCaption).toHaveText(chipName ?? "");
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
