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
    await page
      .getByRole("button", { name: "Сгенерировать новый билд" })
      .click();
    await expect(page).toHaveURL(/[?&]r=k&p=\d+(%2C\d+)*/);
  });

  test("exclude panel toggles a perk and persists to localStorage", async ({
    page,
  }) => {
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

  test("opening a shared build URL loads that exact build", async ({
    page,
  }) => {
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
    await page
      .getByRole("button", { name: "Описание: Аптекарь" })
      .first()
      .click();
    // exact: true — a fuzzy match also catches the "Случайный персонаж"
    // (Random Character) button elsewhere on the page.
    await expect(page.getByText("Персонаж", { exact: true })).toBeVisible();
    // RU locale (see playwright.config.ts) shows the translated character
    // name, not the English slug — "Квентин", not "Quentin".
    await expect(page.getByText("Квентин", { exact: true })).toBeVisible();
  });
});

test.describe("Full Loadout", () => {
  test("switching to loadout mode rolls an item/add-ons/offering HUD", async ({
    page,
  }) => {
    await page.goto("/?role=survivor");
    await page.getByRole("button", { name: "Экипировка" }).click();

    await expect(
      page.getByText("Случайная экипировка для выжившего"),
    ).toBeVisible();
    // The in-game-style HUD groups pieces under fixed Item/Add-ons/Offering
    // columns instead of a generic card grid — see loadout-grid.tsx.
    await expect(page.getByTestId("loadout-slot-item")).toBeVisible();
    await expect(page.getByTestId("loadout-slot-addons")).toBeVisible();
    await expect(page.getByTestId("loadout-slot-offering")).toBeVisible();

    // Regenerating updates the shareable URL to the loadout scheme
    // (mode=loadout&lp=<comma-separated short loadout-piece IDs>).
    await page
      .getByRole("button", { name: "Сгенерировать новый билд" })
      .click();
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

  test("turning off a slot rolls an empty HUD placeholder for it", async ({
    page,
  }) => {
    await page.goto("/?role=survivor&mode=loadout");
    // See the hydration-wait comment on the loadout pool panel test below.
    await expect(
      page.locator("main").locator("img[alt]").first(),
    ).toBeVisible();
    await page.getByRole("button", { name: "Подношение", exact: true }).click();

    // The Offering column heading stays (it's a static label), but its slot
    // no longer has a clickable piece card inside — toggling it off also
    // rerolls the other slots (same nonce bump Generate uses), so this
    // can't assert an exact total piece count, only that this one column
    // is specifically empty.
    const offeringSlot = page.getByTestId("loadout-slot-offering");
    await expect(
      offeringSlot.getByRole("button", { name: /^Описание: /, exact: false }),
    ).toHaveCount(0);
  });

  test("loadout pool panel excludes a piece and persists to localStorage", async ({
    page,
  }) => {
    await page.goto("/?role=survivor&mode=loadout");
    // Loadout pieces only render post-hydration (seeded client-side — see
    // `mounted` in randomizer-board.tsx); waiting for one here doubles as a
    // wait for hydration to finish wiring up the Пул button's onClick
    // before we click it. See the same comment in "Combined All mode"
    // below for the failure this avoids.
    await expect(
      page.locator("main").locator("img[alt]").first(),
    ).toBeVisible();
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

test.describe("Combined All mode", () => {
  test("shows both the perk grid and the loadout HUD together", async ({
    page,
  }) => {
    await page.goto("/?role=survivor");
    // Perks only render post-hydration (they're seeded client-side — see
    // `mounted` in randomizer-board.tsx), so waiting for one here doubles as
    // a wait for hydration to finish attaching the mode toggle's onClick
    // before we click it — otherwise the click can land on the button before
    // React has wired it up and silently do nothing.
    await expect(
      page.locator("main").locator("img[alt]").first(),
    ).toBeVisible();
    await page.getByRole("button", { name: "Всё", exact: true }).click();

    await expect(page.getByTestId("loadout-slot-item")).toBeVisible();
    await expect(page.getByTestId("loadout-slot-addons")).toBeVisible();
    await expect(page.getByTestId("loadout-slot-offering")).toBeVisible();
    // A perk card's Copy button — proves the perk grid rendered alongside
    // the loadout HUD above, not instead of it.
    await expect(
      page.getByRole("button", { name: "Скопировать всё" }),
    ).toBeVisible();

    // "All" mode needs two separate pool buttons (one panel can't cover
    // both perks and loadout pieces at once) instead of the single "Пул"
    // the other two modes use.
    await expect(
      page.getByRole("button", { name: "Пул перков" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Пул экип." })).toBeVisible();

    // Regenerating shares both halves in the URL together.
    await page
      .getByRole("button", { name: "Сгенерировать новый билд" })
      .click();
    await expect(page).toHaveURL(
      /[?&]mode=all&(?:.*&)?lp=\d+(%2C\d+)*(?:.*&)?p=\d+(%2C\d+)*/,
    );
  });

  test("a mode=all share link restores both the perks and the loadout exactly", async ({
    page,
  }) => {
    await page.goto("/?role=survivor");
    // See the hydration-wait comment in the previous test.
    await expect(
      page.locator("main").locator("img[alt]").first(),
    ).toBeVisible();
    await page.getByRole("button", { name: "Всё", exact: true }).click();
    await page
      .getByRole("button", { name: "Сгенерировать новый билд" })
      .click();
    const sharedUrl = page.url();

    await page.goto("about:blank");
    await page.goto(sharedUrl);
    // Same hydration-wait reasoning as above, but for this second, fresh
    // page load — a shared link that opens straight into "all" mode still
    // needs hydration to finish before the loadout HUD (and its testid)
    // exist at all.
    await expect(
      page.locator("main").locator("img[alt]").first(),
    ).toBeVisible();
    await expect(page.getByTestId("loadout-slot-item")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Скопировать всё" }),
    ).toBeVisible();
    // Still the exact same URL after the restore effect settles — proves
    // nothing silently re-rolled on load (a shared build must show
    // *that* build, not a fresh random one).
    await expect(page).toHaveURL(sharedUrl);
  });

  test("each pool button opens its own panel", async ({ page }) => {
    await page.goto("/?role=survivor");
    // See the hydration-wait comment in the first test of this block.
    await expect(
      page.locator("main").locator("img[alt]").first(),
    ).toBeVisible();
    await page.getByRole("button", { name: "Всё", exact: true }).click();

    await page.getByRole("button", { name: "Пул перков" }).click();
    await expect(page.getByText("Настроить пул перков")).toBeVisible();
    await page.getByRole("button", { name: "Закрыть" }).click();

    await page.getByRole("button", { name: "Пул экип." }).click();
    await expect(page.getByText("Настроить пул экипировки")).toBeVisible();
  });
});

test.describe("Character picker", () => {
  test("choosing a character shows a portrait chip that can be cleared", async ({
    page,
  }) => {
    await page.goto("/?role=survivor");
    const chip = page
      .getByRole("button", { name: "Убрать персонажа" })
      .locator("xpath=..");
    await expect(chip).not.toBeVisible();

    await page.getByRole("button", { name: "Выбрать персонажа" }).click();
    // "Random" inside the modal picks and closes in one step, same as
    // clicking any specific portrait would.
    await page.getByRole("button", { name: "Случайный", exact: true }).click();
    await expect(chip).toBeVisible();

    await page.getByRole("button", { name: "Убрать персонажа" }).click();
    await expect(chip).not.toBeVisible();
  });

  test("search filters the grid down to a single portrait to pick", async ({
    page,
  }) => {
    await page.goto("/?role=survivor");
    await page.getByRole("button", { name: "Выбрать персонажа" }).click();

    await page.getByPlaceholder("Поиск персонажа…").fill("Дуайт");
    // Not exact: the button's accessible name combines the portrait's alt
    // text with the visible caption span, both "Дуайт".
    await page.getByRole("button", { name: "Дуайт" }).click();

    const chip = page
      .getByRole("button", { name: "Убрать персонажа" })
      .locator("xpath=..");
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

  test("picking a killer narrows the loadout pool to just their own add-ons", async ({
    page,
  }) => {
    // Regression test: before this, the Manage Pool panel always listed
    // every killer's add-ons together (~750+ entries) even after locking in
    // a specific character via the picker — the vast majority of which
    // could never actually be rolled once a character is forced (see
    // getRandomLoadout's forcedCharacter / getLoadoutPoolForRole's new
    // character param). Picking a killer should shrink the pool to just
    // their own add-ons + offerings.
    await page.goto("/?role=killer&mode=loadout");

    await page.getByRole("button", { name: "Пул", exact: true }).click();
    const poolHeader = page.getByText(/Активно:/);
    const beforeText = await poolHeader.textContent();
    const beforeTotal = Number(beforeText?.split("/")[1]?.trim());
    await page.getByRole("button", { name: "Закрыть" }).click();

    await page.getByRole("button", { name: "Выбрать персонажа" }).click();
    await page.getByRole("button", { name: "Случайный", exact: true }).click();

    await page.getByRole("button", { name: "Пул", exact: true }).click();
    const afterText = await poolHeader.textContent();
    const afterTotal = Number(afterText?.split("/")[1]?.trim());

    expect(beforeTotal).toBeGreaterThan(100);
    expect(afterTotal).toBeGreaterThan(0);
    expect(afterTotal).toBeLessThan(beforeTotal);
  });

  test("picking a character in killer loadout mode decides the rolled Power", async ({
    page,
  }) => {
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
    const powerCaption = page
      .getByTestId("loadout-slot-power")
      .locator("span")
      .last();
    await expect(powerCaption).toHaveText(chipName ?? "");
  });
});

test.describe("theme toggle", () => {
  test("switches theme and persists across interaction", async ({ page }) => {
    await page.goto("/");
    const toggle = page.getByRole("button", { name: "Переключить тему" });
    await toggle.click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

    await page
      .getByRole("button", { name: "Сгенерировать новый билд" })
      .click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  });
});

test.describe("OBS overlay", () => {
  test("?obs=1 triggers the overlay even without the #/obs hash", async ({
    page,
  }) => {
    // Regression test for a real report: the #/obs hash fragment can get
    // stripped in transit before reaching OBS's Browser Source (link-
    // preview rewriters, a data-saving browser proxy, etc. — see
    // lib/use-obs-mode.ts's useIsObsMode docstring), silently showing the
    // normal site instead of the overlay. `obs=1` is the query-param
    // fallback that survives that kind of URL mangling.
    await page.goto("/?room=TESTROOM&obs=1");
    await expect(
      page.getByRole("link", { name: "Vortex Hub" }),
    ).not.toBeVisible();
    await expect(
      page.getByText(/Ждём билд с основного сайта|Waiting for a build/),
    ).toBeVisible();
  });

  test("the site shell is marked hidden before React even hydrates", async ({
    page,
  }) => {
    // Regression test for a real report: even with the *correct* overlay
    // link, some viewers (notably a slower/CEF-based renderer like OBS's
    // own Browser Source) briefly or persistently saw the full site
    // behind the transparent overlay — because a static export can't know
    // the URL at build time, so the very first paint always renders the
    // full site regardless of the URL, and only a post-hydration effect
    // swaps to the overlay. The fix is a synchronous pre-hydration script
    // (app/layout.tsx) plus a CSS rule (globals.css) that hides
    // .app-shell immediately, before any JS framework code runs at all.
    // Since Playwright's own navigation already outruns that pre-paint
    // window, this asserts the underlying mechanism directly instead of
    // trying to catch a frame of flash.
    await page.goto("/?room=TESTROOM&obs=1#/obs");
    await expect(page.locator("html")).toHaveAttribute("data-obs-pending", "1");
    await expect(page.locator(".app-shell")).toHaveCSS("visibility", "hidden");

    await page.goto("/?role=survivor");
    await expect(page.locator("html")).not.toHaveAttribute(
      "data-obs-pending",
      "1",
    );
    await expect(page.locator(".app-shell")).toHaveCSS("visibility", "visible");
  });
});

test.describe("Build History", () => {
  test("a generated build appears in History and can be reopened", async ({
    page,
  }) => {
    await page.goto("/?role=survivor");
    await page.evaluate(() =>
      localStorage.removeItem("dbd-randomizer:history"),
    );
    await page.reload();
    await page
      .getByRole("button", { name: "Сгенерировать новый билд" })
      .click();

    // History moved into the "More" popover (see more-menu.tsx) as part of
    // decluttering the toolbar — open it before the button becomes clickable.
    await page.getByRole("button", { name: "Ещё", exact: true }).click();
    await page.getByRole("button", { name: "История", exact: true }).click();
    const panel = page.getByText("История билдов");
    await expect(panel).toBeVisible();
    // Exactly how many rolls React's dev-mode Strict Mode double-invoke
    // ends up recording isn't worth pinning down here — what matters is
    // that at least one landed and can be reopened.
    const entries = page.getByRole("button", { name: "Открыть" });
    await expect(entries.first()).toBeVisible();

    await entries.first().click();
    await expect(panel).not.toBeVisible();
  });

  test("Clear wipes the history list", async ({ page }) => {
    await page.goto("/?role=survivor");
    await page
      .getByRole("button", { name: "Сгенерировать новый билд" })
      .click();

    // History moved into the "More" popover (see more-menu.tsx) as part of
    // decluttering the toolbar — open it before the button becomes clickable.
    await page.getByRole("button", { name: "Ещё", exact: true }).click();
    await page.getByRole("button", { name: "История", exact: true }).click();
    await page.getByRole("button", { name: "Очистить", exact: true }).click();
    // The confirm dialog's own confirm button shares the same label as the
    // trigger that opened it ("Очистить") — it's the one rendered later in
    // the DOM (ConfirmDialog mounts after HistoryModal's own JSX), so
    // .last() picks the dialog's button, not the now-covered trigger.
    await page
      .getByRole("button", { name: "Очистить", exact: true })
      .last()
      .click();

    await expect(
      page.getByText("Пока пусто — сгенерируйте билд"),
    ).toBeVisible();
  });
});

test.describe("Slot pinning", () => {
  /** The four perk names currently on the board, in slot order.
   *
   *  Filtered to `position: relative` because AnimatePresence keeps the
   *  outgoing cards mounted (absolutely positioned) until their exit
   *  transition finishes — reading every card would pick up the previous
   *  build alongside the current one. */
  const liveBuild = (page: import("@playwright/test").Page) =>
    page.evaluate(() =>
      [...document.querySelectorAll('[data-perk-card="1"]')]
        .filter((c) => getComputedStyle(c).position === "relative")
        .map((c) => c.querySelector("img")!.alt),
    );

  test("a pinned perk survives a reroll while the other slots change", async ({
    page,
  }) => {
    await page.goto("/?role=survivor");
    const pins = page.getByRole("button", { name: /перк$/ });
    await expect(pins).toHaveCount(4);

    const before = await liveBuild(page);
    await pins.nth(1).click();

    // Pinning is not itself a reroll — the board must be untouched.
    expect(await liveBuild(page)).toEqual(before);
    await expect(
      page.getByRole("button", { name: "Открепить перк" }),
    ).toHaveCount(1);

    await page
      .getByRole("button", { name: "Сгенерировать новый билд" })
      .click();
    await expect
      .poll(async () => (await liveBuild(page))[1])
      .toBe(before[1]);
    expect(await liveBuild(page)).toHaveLength(4);
  });

  test("pinning every slot makes a reroll a no-op", async ({ page }) => {
    await page.goto("/?role=survivor");
    for (let i = 0; i < 4; i++) {
      await page.getByRole("button", { name: "Закрепить перк" }).first().click();
    }
    const before = await liveBuild(page);

    await page
      .getByRole("button", { name: "Сгенерировать новый билд" })
      .click();
    await expect.poll(() => liveBuild(page)).toEqual(before);
  });

  test("pins are inert on the other role and return when you switch back", async ({
    page,
  }) => {
    await page.goto("/?role=survivor");
    await page.getByRole("button", { name: "Закрепить перк" }).first().click();
    const survivorBuild = await liveBuild(page);

    await page.getByRole("button", { name: "Убийца" }).click();
    await expect(
      page.getByRole("button", { name: "Открепить перк" }),
    ).toHaveCount(0);

    await page.getByRole("button", { name: "Выживший" }).click();
    await expect
      .poll(async () => (await liveBuild(page))[0])
      .toBe(survivorBuild[0]);
  });

  test("a seeded build has no padlocks at all", async ({ page }) => {
    await page.goto("/?role=survivor&seed=pin-test");
    await expect(page.locator("main img[alt]").first()).toBeVisible();
    await expect(page.getByRole("button", { name: /перк$/ })).toHaveCount(0);
  });
});
