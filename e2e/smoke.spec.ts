import { test, expect, type Page } from "@playwright/test";

// The pool button is matched as /^Пул( \d+)?$/ everywhere below, rather
// than by the exact name "Пул". It grows a count badge as soon as anything
// is excluded, and the badge is its own element, so the accessible name
// becomes "Пул 1" — with a space, even though textContent reads "Пул1".
//
// Matching "Пул" exactly therefore only succeeded in the window before the
// saved pool had hydrated, which made the reload test below pass by
// outrunning the very restore it exists to check. Worth spelling out
// because the first fix here used \d* against the textContent spelling: it
// still matched the bare pre-hydration name, so it kept the race alive and
// looked fine for twelve consecutive runs.
//
// Anchoring the start keeps "Статистика пула" out; anchoring the end keeps
// the separate "Пул перков" / "Пул экип." buttons that All mode shows out.
import { readFile } from "node:fs/promises";

/** The perk names currently on the board, read off the card images.
 *
 *  Waits for the card count to settle first: a regenerate cross-fades, so
 *  the outgoing cards stay mounted until their exit animation finishes and
 *  a naive read catches two builds at once — eight names, half of them from
 *  the build that is on its way out. */
async function boardPerks(page: Page, count = 4): Promise<string[]> {
  await expect(page.locator("[data-perk-card]")).toHaveCount(count);
  return page
    .locator("[data-perk-card] img[alt]")
    .evaluateAll((imgs) => imgs.map((img) => img.getAttribute("alt") ?? ""));
}

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
    await page.getByRole("button", { name: /^Пул( \d+)?$/ }).click();

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

  test("the pool and favourites come back after a reload", async ({ page }) => {
    // Writing to storage and reading it back on the next visit are two
    // different code paths, and only the write was covered. Restoring is
    // the half a returning visitor actually experiences, and it moved into
    // lib/use-persisted-set.ts — a hydrate that silently did nothing would
    // leave the test above passing.
    await page.goto("/");
    await page.getByRole("button", { name: /^Пул( \d+)?$/ }).click();
    await expect(page.getByText("Настроить пул перков")).toBeVisible();

    const cards = page.locator("div.fixed.inset-0").locator('[role="button"]:has(img)');
    await cards.first().click();
    // The star inside a card is the favourite toggle — a separate saved
    // set, restored by the same mechanism.
    await cards.nth(1).locator("button").first().click();

    // Asserted through what the panel *draws*, not through localStorage.
    // Storage keeps its contents whether or not anything reads them back,
    // so a storage-only assertion passes even when hydration is completely
    // broken — confirmed by making hydrate return an empty set, which this
    // catches and the storage version did not.
    const excludedCards = page.locator("div.fixed.inset-0 .grayscale");
    await expect(excludedCards).toHaveCount(1);

    await page.reload();
    await page.getByRole("button", { name: /^Пул( \d+)?$/ }).click();
    await expect(page.getByText("Настроить пул перков")).toBeVisible();
    await expect(page.locator("div.fixed.inset-0 .grayscale")).toHaveCount(1);
  });

  test("exclude panel's Close button actually closes it", async ({ page }) => {
    // Regression test: ExcludePanel and CharacterPickerModal both used a
    // bare `key={role}` ("survivor"/"killer") on themselves as siblings in
    // the same parent — React warned about the duplicate key and, in
    // practice, the reconciliation confusion made the Close button stop
    // responding entirely (see randomizer-board.tsx's namespaced
    // `perk-pool-${role}` / `char-picker-${...}` keys).
    await page.goto("/");
    await page.getByRole("button", { name: /^Пул( \d+)?$/ }).click();
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

  test("a perk's description text actually arrives and renders", async ({ page }) => {
    // Description text is no longer part of the page's payload — it loads
    // from its own chunk on demand (see lib/descriptions.ts). Nothing here
    // asserted the text itself before, so a load that never resolved would
    // have left every card showing a placeholder for good with the whole
    // suite still green.
    await page.goto("/?role=survivor&perks=pharmacy");
    await page.getByRole("button", { name: "Описание: Аптекарь" }).first().click();

    // Scoped to the card rather than the dialog role: this page also has
    // the off-screen ShareCard, and narrowing to the visible modal keeps
    // the assertions about what a person is actually looking at.
    const modal = page.locator(".modal-card");
    // Core Effect is the default tab; its bullets are the derived summary,
    // and there are none at all while the placeholder is showing.
    await expect(modal.getByRole("listitem").first()).not.toBeEmpty();

    await modal.getByRole("button", { name: "Подробно" }).click();
    // Real prose rather than a stub — this perk is about med-kits in both
    // languages the site renders.
    await expect(modal.getByText(/аптечк|med-?kit/i).first()).toBeVisible();
  });

  test("a loadout piece's description arrives from its own bundle", async ({ page }) => {
    // Loadout prose is a separate chunk from perk prose, so a working perk
    // modal says nothing about this one.
    await page.goto("/?role=survivor&mode=loadout");
    await expect(page.locator("[data-piece-kind]").first()).toBeVisible();
    await page.locator("[data-piece-kind]").first().click();

    const modal = page.locator(".modal-card");
    await expect(modal.getByRole("listitem").first()).not.toBeEmpty();
    await modal.getByRole("button", { name: "Подробно" }).click();
    // Any real sentence will do — what's being checked is that prose
    // reached the modal at all, not which piece happened to be rolled.
    await expect
      .poll(async () => (await modal.locator("p").allTextContents()).join(" ").length)
      .toBeGreaterThan(40);
  });
});

test.describe("Dialog behaviour", () => {
  // An audit found role="dialog" on one of the eight modals, an Escape
  // handler on none, and no focus management anywhere. These cover the
  // shared hook that fixes it (lib/use-modal.ts), across enough different
  // dialogs to catch one being wired up wrong.

  /** Every dialog reachable from the board, with how to open it. */
  const dialogs = [
    {
      name: "perk description",
      open: async (page: import("@playwright/test").Page) => {
        await page.goto("/?role=survivor&perks=pharmacy");
        await page.getByRole("button", { name: "Описание: Аптекарь" }).first().click();
      },
    },
    {
      name: "perk pool",
      open: async (page: import("@playwright/test").Page) => {
        await page.goto("/");
        await page.getByRole("button", { name: /^Пул( \d+)?$/ }).click();
      },
    },
    {
      name: "OBS overlay",
      open: async (page: import("@playwright/test").Page) => {
        await page.goto("/?role=survivor");
        await expect(page.locator("main").locator("img[alt]").first()).toBeVisible();
        await page.getByRole("button", { name: /Оверлей OBS/ }).click();
      },
    },
  ];

  for (const { name, open } of dialogs) {
    test(`${name}: announces itself as a dialog and closes on Escape`, async ({ page }) => {
      await open(page);
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await expect(dialog).toHaveAttribute("aria-modal", "true");

      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);
    });
  }

  test("focus moves into the dialog and returns to the button that opened it", async ({
    page,
  }) => {
    await page.goto("/");
    const poolButton = page.getByRole("button", { name: /^Пул( \d+)?$/ });
    await poolButton.click();

    // Focus starts on the dialog itself rather than being left behind on
    // the page, so the next Tab lands inside.
    await expect(page.getByRole("dialog")).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(poolButton).toBeFocused();
  });

  test("Tab stays inside the dialog instead of reaching the page behind it", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /^Пул( \d+)?$/ }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // Enough presses to run past the end of any reasonable dialog and wrap.
    for (let i = 0; i < 40; i++) await page.keyboard.press("Tab");

    const insideDialog = await dialog.evaluate((el) => el.contains(document.activeElement));
    expect(insideDialog).toBe(true);
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
    //
    // The *first* image is not a strong enough signal — it shows up while
    // the grid is still filling in, so the click could still land before
    // React had attached the handler and the panel then never opened at
    // all. A settled set of pieces is what actually means "hydrated".
    await expect
      .poll(() => page.locator("[data-piece-slug]").count())
      .toBeGreaterThan(2);
    await page.getByRole("button", { name: /^Пул( \d+)?$/ }).click();

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

test.describe("Loadout pairing on the page", () => {
  // lib/loadout-roll.test.ts already rolls getRandomLoadout thousands of
  // times and asserts the same pairing rules. This exists because that is
  // not what a player looks at. The Fog Vial bug was reported from the
  // live site, and between the roller and the screen sit the URL
  // round-trip, the seeded/daily path, hydration, and LoadoutGrid picking
  // pieces out of a flat array by `kind` — any of which could pair the
  // slots correctly in memory and still draw them wrong.
  //
  // What's read here is the piece cards' own data-* attributes rather than
  // their labels: names are localized and give no clue what type they are,
  // so checking the visible text would mean mapping RU names back to item
  // types in the test, i.e. reimplementing the thing under test.

  interface RenderedPiece {
    kind: string | null;
    slug: string | null;
    itemType: string | null;
    character: string | null;
  }

  /** Survivors show Item + 2 Add-ons + Offering; killers show a Power
   *  instead of an item, and the Power is an <img>, not a piece card. */
  const PIECE_COUNT = { survivor: 4, killer: 3 } as const;

  async function renderedBuild(page: import("@playwright/test").Page): Promise<RenderedPiece[]> {
    return page.locator("[data-piece-kind]").evaluateAll((nodes) =>
      nodes.map((n) => ({
        kind: n.getAttribute("data-piece-kind"),
        slug: n.getAttribute("data-piece-slug"),
        itemType: n.getAttribute("data-item-type"),
        character: n.getAttribute("data-character"),
      })),
    );
  }

  /**
   * The build once it has finished swapping in.
   *
   * Each slot animates its old piece out before the new one enters, so a
   * read taken too early can catch a half-swapped HUD — some slots new,
   * some still old — which looks exactly like the mismatch these tests are
   * hunting for. Waiting for the full complement of slots to be occupied
   * rules that out.
   *
   * Pass `unlike` to wait for a *different* build than the one named. It
   * compares the whole build rather than one slot: an individual slot can
   * legitimately reroll into the same piece (some item types have only a
   * handful of add-ons), so "this one slot changed" is not a sound signal
   * that a reroll happened, while four slots landing identically is not
   * something that occurs in practice.
   */
  async function settledBuild(
    page: import("@playwright/test").Page,
    role: "survivor" | "killer",
    unlike?: RenderedPiece[],
  ): Promise<RenderedPiece[]> {
    const fingerprint = unlike ? JSON.stringify(unlike) : null;
    await expect
      .poll(async () => {
        const build = await renderedBuild(page);
        if (build.length !== PIECE_COUNT[role]) return false;
        return fingerprint === null || JSON.stringify(build) !== fingerprint;
      }, { timeout: 10_000 })
      .toBe(true);
    return renderedBuild(page);
  }

  /** Every complaint a build can draw, as sentences — collected rather
   *  than thrown one at a time, so a failing run reports what was actually
   *  on screen instead of only the first thing noticed. */
  function complaints(pieces: RenderedPiece[], role: "survivor" | "killer"): string[] {
    const found: string[] = [];
    const item = pieces.find((p) => p.kind === "item") ?? null;
    const addons = pieces.filter((p) => p.kind === "addon");

    if (role === "survivor") {
      for (const addon of addons) {
        if (!item) {
          found.push(`add-on ${addon.slug} rendered with no item`);
        } else if (addon.itemType !== item.itemType) {
          found.push(`${addon.slug} (${addon.itemType}) rendered on ${item.slug} (${item.itemType})`);
        }
      }
    } else {
      if (item) found.push(`killer build rendered an item slot (${item.slug})`);
      // A killer's two add-ons come from one killer's power, and the Power
      // icon shown beside them is derived from addons[0] — so a build
      // mixing two killers would also mislabel the Power.
      const owners = [...new Set(addons.map((a) => a.character))];
      if (owners.length > 1) found.push(`add-ons from ${owners.length} killers at once: ${owners.join(", ")}`);
      if (owners.includes("All")) found.push("a killer add-on rendered on the general sentinel");
    }

    const slugs = pieces.map((p) => `${p.kind}:${p.slug}`);
    if (new Set(slugs).size !== slugs.length) found.push(`the same piece twice: ${slugs.join(", ")}`);
    return found;
  }

  for (const role of ["survivor", "killer"] as const) {
    test(`${role} add-ons match what they're shown next to, across rerolls`, async ({ page }) => {
      await page.goto(`/?role=${role}&mode=loadout`);

      const regenerate = page.getByRole("button", { name: "Сгенерировать новый билд" });
      const seen = new Set<string>();
      const found: string[] = [];
      let pieces = await settledBuild(page, role);

      // Enough rerolls to cover the item types several times over. The bug
      // this guards affected whole types, so it would show up within the
      // first few — the rest is margin against a type that rolls rarely.
      for (let i = 0; i < 25; i++) {
        found.push(...complaints(pieces, role).map((c) => `reroll ${i}: ${c}`));
        const item = pieces.find((p) => p.kind === "item");
        if (item?.itemType) seen.add(item.itemType);
        await regenerate.click();
        pieces = await settledBuild(page, role, pieces);
      }

      expect(found, "the rendered build contradicted its own slots").toEqual([]);
      if (role === "survivor") {
        // A survivor build that never rolled an item at all would satisfy
        // every check above vacuously.
        expect(seen.size, "25 rerolls should turn up more than one item type").toBeGreaterThan(1);
      }
    });
  }

  test("a shared loadout link renders the same pairing the sender saw", async ({ page }) => {
    // The URL round-trip rebuilds a build from short piece IDs rather than
    // rolling it, so it can pair slots wrongly even when the roller can't.
    await page.goto("/?role=survivor&mode=loadout");
    const before = await settledBuild(page, "survivor");
    await page.getByRole("button", { name: "Сгенерировать новый билд" }).click();
    await expect(page).toHaveURL(/[?&]lp=\d+/);

    // Read after the swap settles: the URL updates on the click, so a read
    // taken with it would capture the build being replaced, not the one
    // the link now describes.
    const sent = await settledBuild(page, "survivor", before);
    expect(complaints(sent, "survivor")).toEqual([]);

    const url = page.url();
    await page.goto("about:blank");
    await page.goto(url);
    await expect.poll(() => renderedBuild(page)).toEqual(sent);
  });

  test("a seeded loadout is paired correctly, and is the same for everyone", async ({ page }) => {
    // Seeded builds come from getSeededLoadout, a second implementation of
    // the roll — the one behind Daily Challenge, whose seed is exactly this
    // `<date>-<role>` shape. A wrong pairing here is wrong for every player
    // at once and can't be rerolled away, so it's worth its own check
    // rather than trusting that the two implementations agree.
    const seed = "2026-08-19-survivor";
    await page.goto(`/?role=survivor&mode=loadout&seed=${seed}`);
    const first = await settledBuild(page, "survivor");
    expect(complaints(first, "survivor")).toEqual([]);

    // Same seed, fresh load: everyone taking the challenge must see this.
    await page.goto("about:blank");
    await page.goto(`/?role=survivor&mode=loadout&seed=${seed}`);
    await expect.poll(() => renderedBuild(page)).toEqual(first);
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
    const toggle = page.getByRole("switch", { name: "Гарантировать личные перки" });
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

    await page.getByRole("button", { name: /^Пул( \d+)?$/ }).click();
    const poolHeader = page.getByText(/Активно:/);
    const beforeText = await poolHeader.textContent();
    const beforeTotal = Number(beforeText?.split("/")[1]?.trim());
    await page.getByRole("button", { name: "Закрыть" }).click();

    await page.getByRole("button", { name: "Выбрать персонажа" }).click();
    await page.getByRole("button", { name: "Случайный", exact: true }).click();

    await page.getByRole("button", { name: /^Пул( \d+)?$/ }).click();
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

test.describe("OBS Overlay modal", () => {
  // The modal is where a streamer configures the overlay, and until now
  // nothing exercised it — the "OBS overlay" tests above only load the
  // overlay *page*. That gap mattered when the modal was split into panels
  // and hooks: the whole suite stayed green while none of it had ever
  // opened this dialog.
  //
  // Everything here is asserted through the generated link, because the
  // link is the actual product of this dialog: whatever the controls do,
  // what reaches OBS is the URL.

  async function openObsModal(page: import("@playwright/test").Page) {
    await page.goto("/?role=survivor");
    await expect(page.locator("main").locator("img[alt]").first()).toBeVisible();
    await page.getByRole("button", { name: /Оверлей OBS/ }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
  }

  /** The overlay link currently shown, which is what a streamer pastes. */
  async function overlayLink(page: import("@playwright/test").Page) {
    return (await page.getByRole("dialog").locator("code").first().textContent()) ?? "";
  }

  test("the three tabs each show their own panel", async ({ page }) => {
    await openObsModal(page);
    const dialog = page.getByRole("dialog");

    // Overlay tab is the default.
    await expect(dialog.getByText("Оформление")).toBeVisible();

    await dialog.getByRole("tab", { name: "Twitch чат" }).click();
    await expect(dialog.getByText("Управление из чата Twitch")).toBeVisible();
    await expect(dialog.getByText("Оформление")).toHaveCount(0);

    await dialog.getByRole("tab", { name: "Конструктор" }).click();
    await expect(dialog.getByText("Конструктор билда")).toBeVisible();

    await dialog.getByRole("tab", { name: "Оверлей" }).click();
    await expect(dialog.getByText("Оформление")).toBeVisible();
  });

  test("a style preset rewrites the link and the OBS setup dimensions", async ({ page }) => {
    await openObsModal(page);
    const dialog = page.getByRole("dialog");

    await dialog.getByRole("button", { name: "Компакт" }).click();
    const compact = await overlayLink(page);
    await dialog.getByRole("button", { name: "Просторно" }).click();
    const roomy = await overlayLink(page);
    expect(roomy).not.toBe(compact);

    // The setup steps quote the canvas size the preset implies — if those
    // drifted from the preset, a streamer would size their Browser Source
    // wrong and see a cropped overlay.
    await dialog.getByRole("button", { name: "Настройка в OBS" }).click();
    await expect(dialog.getByText("1100")).toBeVisible();
    await expect(dialog.getByText("420")).toBeVisible();
  });

  test("the custom dials only appear for the Custom preset, and drive the link", async ({
    page,
  }) => {
    await openObsModal(page);
    const dialog = page.getByRole("dialog");
    const cardSize = dialog.getByRole("slider", { name: "Размер карточек" });

    await expect(cardSize).toHaveCount(0);
    await dialog.getByRole("button", { name: "Свой" }).click();
    await expect(cardSize).toBeVisible();

    const before = await overlayLink(page);
    await cardSize.fill("80");
    await expect.poll(() => overlayLink(page)).not.toBe(before);
  });

  test("toggling card names off is reflected in the link", async ({ page }) => {
    await openObsModal(page);
    const dialog = page.getByRole("dialog");
    const before = await overlayLink(page);
    const names = dialog.getByRole("switch", { name: "Показывать названия карточек" });
    // Off by default on purpose — a full row of name pills reads as clutter
    // over stream footage (see DEFAULT_OBS_OPTIONS).
    await expect(names).toHaveAttribute("aria-checked", "false");

    await names.click();
    await expect(names).toHaveAttribute("aria-checked", "true");
    await expect.poll(() => overlayLink(page)).not.toBe(before);

    // Off again returns the link to exactly what it was — the toggle writes
    // one parameter rather than accumulating state.
    await names.click();
    await expect.poll(() => overlayLink(page)).toBe(before);
  });

  test("dragging a preview icon writes positions into the link, and Reset clears them", async ({
    page,
  }) => {
    await openObsModal(page);
    const dialog = page.getByRole("dialog");
    const before = await overlayLink(page);

    // The preview canvas is the drag surface; the first slot sits in its
    // upper-left quadrant.
    const canvas = dialog.locator("div.touch-none").first();
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    const { x, y, width, height } = box!;
    await page.mouse.move(x + width * 0.125, y + height * 0.33);
    await page.mouse.down();
    await page.mouse.move(x + width * 0.6, y + height * 0.6, { steps: 8 });
    await page.mouse.up();

    const dragged = await overlayLink(page);
    expect(dragged).not.toBe(before);

    await dialog.getByRole("button", { name: "Сбросить" }).click();
    await expect.poll(() => overlayLink(page)).toBe(before);
  });

  test("the constructor builds a paste command and clears it on role switch", async ({
    page,
  }) => {
    await openObsModal(page);
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("tab", { name: "Конструктор" }).click();

    await expect(dialog.getByText("Выбери до 4 перков, чтобы получить команду.")).toBeVisible();
    await expect(dialog.getByText("0/4")).toBeVisible();

    // The grid of pickable perks sits under the search box.
    const picker = dialog.locator("div.grid.overflow-y-auto").first();
    await picker.locator("button").nth(0).click();
    await picker.locator("button").nth(1).click();
    await expect(dialog.getByText("2/4")).toBeVisible();
    await expect(dialog.locator("code")).toContainText("!paste");

    // A build can't mix survivor and killer perks, so switching role has to
    // drop the selection rather than produce an unpasteable command.
    await dialog.getByRole("button", { name: "Убийца", exact: true }).click();
    await expect(dialog.getByText("0/4")).toBeVisible();
    await expect(dialog.locator("code")).toHaveCount(0);
  });

  test("the constructor stops at four perks", async ({ page }) => {
    await openObsModal(page);
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("tab", { name: "Конструктор" }).click();

    const picker = dialog.locator("div.grid.overflow-y-auto").first();
    for (let i = 0; i < 4; i++) await picker.locator("button").nth(i).click();
    await expect(dialog.getByText("4/4")).toBeVisible();
    // A fifth is refused by disabling every unselected perk, rather than by
    // silently swapping one out — so the choice stays the user's.
    await expect(picker.locator("button").nth(4)).toBeDisabled();
    // The four already picked stay clickable, since clicking one removes it.
    await expect(picker.locator("button").nth(0)).toBeEnabled();
  });

  test("holding parks the overlay and counts the rolls it withheld", async ({ page }) => {
    // The overlay mirrors the site through an effect that fires on every
    // change, so rolling until something looks good used to play out live.
    // What's asserted is the count of withheld rolls, because that is the
    // observable proof the publish was actually suppressed rather than
    // just relabelled.
    await openObsModal(page);
    const dialog = page.getByRole("dialog");
    const hold = dialog.getByRole("switch", { name: /Держать билд/ });

    await expect(hold).toHaveAttribute("aria-checked", "false");
    await expect(dialog.getByRole("button", { name: /Показать/ })).toHaveCount(0);

    await hold.click();
    await expect(hold).toHaveAttribute("aria-checked", "true");
    const reveal = dialog.getByRole("button", { name: /Показать/ });
    await expect(reveal).toBeVisible();

    // Roll with the dialog closed — which is what a streamer does, and
    // also the only way to reach the button, since the modal covers it.
    // The hold lives on the board, not in the dialog, so the count carries
    // across closing and reopening.
    await dialog.getByRole("button", { name: "Закрыть" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByRole("button", { name: "Сгенерировать новый билд" }).click();
    await page.getByRole("button", { name: "Сгенерировать новый билд" }).click();

    await page.getByRole("button", { name: /Оверлей OBS/ }).click();
    const reopened = page.getByRole("dialog");
    await expect(reopened.getByText(/С тех пор роллов: 2/)).toBeVisible();

    // Revealing clears the backlog.
    await reopened.getByRole("button", { name: /Показать/ }).click();
    await expect(reopened.getByText(/С тех пор роллов:/)).toHaveCount(0);
  });

  test("the hold survives a reload, since a stream does too", async ({ page }) => {
    await openObsModal(page);
    await page.getByRole("dialog").getByRole("switch", { name: /Держать билд/ }).click();

    await page.reload();
    await page.getByRole("button", { name: /Оверлей OBS/ }).click();
    await expect(
      page.getByRole("dialog").getByRole("switch", { name: /Держать билд/ }),
    ).toHaveAttribute("aria-checked", "true");
  });

  test("a saved layout comes back after a reload and rebuilds the link", async ({ page }) => {
    await openObsModal(page);
    const dialog = page.getByRole("dialog");

    // Make the current look distinctive, then bookmark it.
    await dialog.getByRole("button", { name: "Компакт" }).click();
    const compactLink = await overlayLink(page);
    await dialog.getByRole("button", { name: /Сохранить текущую/ }).click();
    await dialog.getByRole("textbox", { name: "Название раскладки" }).fill("Игровая");
    await dialog.getByRole("button", { name: "Сохранить", exact: true }).click();
    await expect(dialog.getByRole("button", { name: "Игровая", exact: true })).toBeVisible();

    // Move away from it, then come back via the bookmark.
    await dialog.getByRole("button", { name: "Просторно" }).click();
    await expect.poll(() => overlayLink(page)).not.toBe(compactLink);

    await page.reload();
    await page.getByRole("button", { name: /Оверлей OBS/ }).click();
    const reopened = page.getByRole("dialog");
    await reopened.getByRole("button", { name: "Игровая", exact: true }).click();
    // The link is regenerated from the restored settings, not stored — so
    // matching the original is what proves the settings came back whole.
    await expect.poll(() => overlayLink(page)).toBe(compactLink);
  });

  test("a saved layout can be deleted", async ({ page }) => {
    await openObsModal(page);
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: /Сохранить текущую/ }).click();
    await dialog.getByRole("textbox", { name: "Название раскладки" }).fill("Временная");
    await dialog.getByRole("button", { name: "Сохранить", exact: true }).click();
    await expect(dialog.getByRole("button", { name: "Временная", exact: true })).toBeVisible();

    await dialog.getByRole("button", { name: "Удалить раскладку Временная" }).click();
    await expect(dialog.getByRole("button", { name: "Временная", exact: true })).toHaveCount(0);
  });

  test("Twitch commands stay hidden until the disclosure is opened", async ({ page }) => {
    await openObsModal(page);
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("tab", { name: "Twitch чат" }).click();

    const rerollCommand = dialog.getByRole("textbox", { name: "Команда реролла" });
    await expect(rerollCommand).toHaveCount(0);
    await dialog.getByRole("button", { name: "Команды и права доступа" }).click();
    await expect(rerollCommand).toBeVisible();

    await dialog.getByRole("textbox", { name: "Имя канала Twitch" }).fill("some_channel");
    await expect(dialog.getByRole("textbox", { name: "Имя канала Twitch" })).toHaveValue(
      "some_channel",
    );
  });
});

test.describe("Pool coverage", () => {
  async function openStats(page: import("@playwright/test").Page) {
    await page.goto("/?role=survivor");
    await expect(page.locator("main").locator("img[alt]").first()).toBeVisible();
    await page.getByRole("button", { name: "Ещё", exact: true }).click();
    await page.getByRole("button", { name: "Статистика", exact: true }).click();
  }

  test("counts the perks that have come up, out of the whole pool", async ({ page }) => {
    // "Least rolled" already names five perks that haven't appeared; this
    // is the count of how many are left, which nothing answered before.
    await page.goto("/?role=survivor");
    await expect(page.locator("main").locator("img[alt]").first()).toBeVisible();
    // Two builds so the first four perks are definitely recorded.
    await page.getByRole("button", { name: "Сгенерировать новый билд" }).click();
    await page.getByRole("button", { name: "Сгенерировать новый билд" }).click();

    await page.getByRole("button", { name: "Ещё", exact: true }).click();
    await page.getByRole("button", { name: "Статистика", exact: true }).click();

    const bar = page.getByRole("progressbar", { name: "Открыто перков" });
    await expect(bar).toBeVisible();
    const seen = Number(await bar.getAttribute("aria-valuenow"));
    const pool = Number(await bar.getAttribute("aria-valuemax"));

    // A handful of perks seen, out of the real survivor pool.
    expect(seen).toBeGreaterThan(0);
    expect(pool).toBeGreaterThan(100);
    expect(seen).toBeLessThanOrEqual(pool);
    await expect(page.getByText(/Ещё \d+ ни разу не выпадали\./)).toBeVisible();
  });

  test("the count rises as more perks come up", async ({ page }) => {
    await openStats(page);
    const bar = page.getByRole("progressbar", { name: "Открыто перков" });
    const before = Number(await bar.getAttribute("aria-valuenow"));

    // Close, roll a lot, reopen — with 300+ perks and 4 per build, a dozen
    // builds will turn up something new.
    await page.getByRole("button", { name: "Закрыть" }).first().click();
    for (let i = 0; i < 12; i++) {
      await page.getByRole("button", { name: "Сгенерировать новый билд" }).click();
    }
    await openStats(page);
    await expect
      .poll(async () => Number(await bar.getAttribute("aria-valuenow")))
      .toBeGreaterThan(before);
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

/** The perk names currently on the board, in slot order.
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

/** Loads the board and waits for a full four-perk build before returning it.
 *  Reading the build straight after goto() races hydration and yields []. */
async function openBoard(page: import("@playwright/test").Page) {
  await page.goto("/?role=survivor");
  await expect.poll(async () => (await liveBuild(page)).length).toBe(4);
  return liveBuild(page);
}

test.describe("Slot pinning", () => {
  test("a pinned perk survives a reroll while the other slots change", async ({
    page,
  }) => {
    const before = await openBoard(page);
    const pins = page.getByRole("button", { name: /^(За|От)крепить перк$/ });
    await expect(pins).toHaveCount(4);

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
    await openBoard(page);
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
    await openBoard(page);
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
    await expect(
      page.getByRole("button", { name: /^(За|От)крепить перк$/ }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Перебросить этот перк" }),
    ).toHaveCount(0);
  });

  test("unpinning leaves the build exactly as it was", async ({ page }) => {
    await openBoard(page);
    await page.getByRole("button", { name: "Закрепить перк" }).first().click();
    await page
      .getByRole("button", { name: "Сгенерировать новый билд" })
      .click();
    await expect
      .poll(async () => (await liveBuild(page)).length)
      .toBe(4);

    // A pin masks whatever the roll put in that slot, so dropping it must
    // not uncover a different perk — "this may change from now on", not
    // "this changes right now".
    const before = await liveBuild(page);
    await page.getByRole("button", { name: "Открепить перк" }).click();
    await expect.poll(() => liveBuild(page)).toEqual(before);
  });
});

test.describe("Daily Challenge", () => {
  test("activating it shows the seed, with or without a shared count", async ({
    page,
  }) => {
    await openBoard(page);
    await page.getByRole("button", { name: "Ещё", exact: true }).click();
    await page.getByRole("button", { name: "Задание дня", exact: true }).click();

    // The count comes from Firebase, which a CI runner may not reach at
    // all — so the assertion is on the part that must work regardless.
    // The counter is allowed to be absent; it is not allowed to break the
    // line it lives in, or to claim nobody has played.
    const seedLine = page.getByText(/Активный сид:/);
    await expect(seedLine).toBeVisible();
    await expect(seedLine).toContainText(/\d{4}-\d{2}-\d{2}-(survivor|killer)/);
    await expect(seedLine).not.toContainText(/сыграл\w* 0 /);
    await expect(page).toHaveURL(/[?&]seed=\d{4}-\d{2}-\d{2}-/);
  });

  test("a custom seed never shows the shared count", async ({ page }) => {
    // The count only means something for a build everyone shares; a custom
    // seed is yours alone.
    await page.goto("/?role=survivor&seed=my-own-seed");
    await expect(page.getByText(/Активный сид:/)).toContainText("my-own-seed");
    await expect(page.getByText(/Активный сид:/)).not.toContainText(/сыграл/);
  });
});

test.describe("Preset builds", () => {
  async function openPresets(page: import("@playwright/test").Page) {
    await openBoard(page);
    await page.getByRole("button", { name: "Ещё", exact: true }).click();
    await page.getByRole("button", { name: "Готовые билды", exact: true }).click();
    await expect(page.getByText("Готовые билды").first()).toBeVisible();
  }

  test("applying a preset shows exactly that build", async ({ page }) => {
    await openPresets(page);
    await page.getByRole("button", { name: /^Тихий выживший/ }).click();

    await expect.poll(() => liveBuild(page)).toEqual([
      "Железная воля",
      "Городской бег",
      "Искажение",
      "Легковес",
    ]);
    // Applying goes through the shared-build path, so the URL describes it
    // and the link is shareable like any other build.
    await expect(page).toHaveURL(/[?&]r=s&p=\d+(%2C\d+)*/);
  });

  test("a preset is a fixed build, so it offers no pins or rerolls", async ({
    page,
  }) => {
    await openPresets(page);
    await page.getByRole("button", { name: /^Второй шанс/ }).click();
    await expect.poll(async () => (await liveBuild(page)).length).toBe(4);

    // Same rule as a shared or seeded build: there is nothing to reroll
    // around in a build that was handed to you whole.
    await expect(
      page.getByRole("button", { name: /^(За|От)крепить перк$/ }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Перебросить этот перк" }),
    ).toHaveCount(0);
  });

  test("Generate replaces a preset with a fresh random build", async ({ page }) => {
    await openPresets(page);
    await page.getByRole("button", { name: /^Охота на тотемы/ }).click();
    await expect.poll(async () => (await liveBuild(page))[0]).toBe("Мелкая дичь");

    await page
      .getByRole("button", { name: "Сгенерировать новый билд" })
      .click();
    // A preset is a starting point, not a mode — rolling leaves it, and the
    // per-slot controls come back with the random build.
    await expect
      .poll(() => page.getByRole("button", { name: "Перебросить этот перк" }).count())
      .toBe(4);
  });

  test("the killer picker offers the killer presets", async ({ page }) => {
    await openBoard(page);
    await page.getByRole("button", { name: "Убийца" }).click();
    await page.getByRole("button", { name: "Ещё", exact: true }).click();
    await page.getByRole("button", { name: "Готовые билды", exact: true }).click();

    await expect(page.getByRole("button", { name: /^Порчи/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Тихий выживший/ })).toHaveCount(0);
  });
});

test.describe("Single-slot reroll", () => {
  test("the dice button changes only its own slot", async ({ page }) => {
    const before = await openBoard(page);

    await page.getByRole("button", { name: "Перебросить этот перк" }).nth(2).click();
    await expect.poll(async () => (await liveBuild(page))[2]).not.toBe(before[2]);

    const after = await liveBuild(page);
    expect([after[0], after[1], after[3]]).toEqual([
      before[0],
      before[1],
      before[3],
    ]);
    // Rerolling must never hand back a perk the build already holds.
    expect(new Set(after).size).toBe(4);
  });

  test("the 1-4 keys reroll the matching slot", async ({ page }) => {
    const before = await openBoard(page);

    await page.locator("body").press("1");
    await expect.poll(async () => (await liveBuild(page))[0]).not.toBe(before[0]);
    expect((await liveBuild(page)).slice(1)).toEqual(before.slice(1));
  });

  test("a pinned slot refuses to reroll", async ({ page }) => {
    await openBoard(page);
    await page.getByRole("button", { name: "Закрепить перк" }).first().click();
    const before = await liveBuild(page);

    await expect(
      page.getByRole("button", { name: "Перебросить этот перк" }).first(),
    ).toBeDisabled();
    await page.locator("body").press("1");
    await expect.poll(() => liveBuild(page)).toEqual(before);
  });

  test("a full regenerate supersedes single-slot rerolls", async ({ page }) => {
    await openBoard(page);
    await page.getByRole("button", { name: "Перебросить этот перк" }).first().click();
    const rerolled = (await liveBuild(page))[0];

    await page
      .getByRole("button", { name: "Сгенерировать новый билд" })
      .click();
    // Not a strict "must differ" — the fresh roll could legitimately land on
    // the same perk. What matters is that the override was dropped, so
    // rerolling again from the new build still moves only slot 1.
    await expect.poll(async () => (await liveBuild(page)).length).toBe(4);
    const fresh = await liveBuild(page);
    await page.getByRole("button", { name: "Перебросить этот перк" }).first().click();
    await expect.poll(async () => (await liveBuild(page))[0]).not.toBe(fresh[0]);
    expect((await liveBuild(page)).slice(1)).toEqual(fresh.slice(1));
    expect(rerolled).toBeTruthy();
  });
});

test.describe("Battle Royale", () => {
  /** "Использовано в Battle Royale: 8 · Осталось: 307" → [8, 307]. */
  async function attrition(page: Page): Promise<[number, number]> {
    const text = await page
      .getByText("Использовано в Battle Royale:")
      .first()
      .innerText();
    const numbers = text.match(/\d+/g) ?? [];
    return [Number(numbers[0]), Number(numbers[1])];
  }

  test("every round permanently retires the build it replaces", async ({
    page,
  }) => {
    // The mode's entire premise — "play until every perk for this role is
    // gone" — and none of it was covered. A regression here is invisible in
    // a single round: the build still rolls, it just quietly stops draining
    // the pool, so the mode silently becomes ordinary randomisation.
    await page.goto("/?role=survivor");
    await expect(page.locator("[data-perk-card]").first()).toBeVisible();

    await page.getByRole("switch", { name: "Battle Royale" }).click();
    await page.getByRole("button", { name: "Статистика пула" }).click();

    const [usedAtStart, remainingAtStart] = await attrition(page);
    expect(usedAtStart, "switching the mode on starts a fresh run").toBe(0);

    const generate = page.getByRole("button", {
      name: "Сгенерировать новый билд",
    });
    const rounds: string[][] = [await boardPerks(page)];
    for (let round = 0; round < 3; round++) {
      const before = rounds[rounds.length - 1];
      // The board is rebuilt in place, so wait for the perks to actually
      // differ rather than for a visibility change that never happens.
      await generate.click();
      await expect
        .poll(() => boardPerks(page).then((p) => p.join()))
        .not.toBe(before.join());
      rounds.push(await boardPerks(page));
    }

    const [used, remaining] = await attrition(page);
    expect(used, "three rounds should retire three builds").toBe(12);
    expect(remaining).toBe(remainingAtStart - 12);

    // The counter can be right while the pool is not; what actually matters
    // is that a retired perk never comes back.
    const seen = rounds.flat();
    expect(new Set(seen).size, `repeats among ${seen.join(", ")}`).toBe(
      seen.length,
    );
  });

  test("switching the mode off and on again starts a new run", async ({
    page,
  }) => {
    await page.goto("/?role=survivor");
    await expect(page.locator("[data-perk-card]").first()).toBeVisible();
    const toggle = page.getByRole("switch", { name: "Battle Royale" });
    await toggle.click();
    await page.getByRole("button", { name: "Статистика пула" }).click();
    await page
      .getByRole("button", { name: "Сгенерировать новый билд" })
      .click();
    await expect.poll(() => attrition(page).then(([u]) => u)).toBe(4);

    await toggle.click();
    await expect(
      page.getByText("Использовано в Battle Royale:"),
    ).not.toBeVisible();
    await toggle.click();
    expect((await attrition(page))[0]).toBe(0);
  });
});

test.describe("Download Image", () => {
  /** Width and height straight out of a PNG's IHDR chunk, which sits at a
   *  fixed offset — cheaper and more trustworthy than decoding the image. */
  function pngSize(buffer: Buffer): { width: number; height: number } {
    expect(buffer.subarray(0, 8).toString("hex"), "not a PNG").toBe(
      "89504e470d0a1a0a",
    );
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }

  async function grab(page: Page, format: RegExp) {
    const started = page.waitForEvent("download");
    await page.getByRole("button", { name: /Скачать картинку/ }).click();
    await page.getByRole("menuitem", { name: format }).click();
    const file = await started;
    const path = await file.path();
    return { name: file.suggestedFilename(), buffer: await readFile(path) };
  }

  test("each format produces a real PNG in its own shape", async ({ page }) => {
    // Untested end to end until now: the button rasterises a hidden
    // off-screen ShareCard through html2canvas, and a failure in there is
    // caught and turned into a toast — so a completely broken export still
    // looks like a working button.
    await page.goto("/?role=survivor");
    await expect(page.locator("[data-perk-card]").first()).toBeVisible();

    const landscape = await grab(page, /Стандартный/);
    expect(landscape.name).toMatch(/^dbd-survivor-build-.+\.png$/);
    expect(landscape.name).not.toContain("-story");
    const wide = pngSize(landscape.buffer);
    expect(wide.width).toBeGreaterThan(wide.height);

    const story = await grab(page, /История/);
    expect(story.name).toMatch(/^dbd-survivor-build-.+-story\.png$/);
    const tall = pngSize(story.buffer);
    // The two formats exist to be different shapes; asking for the story
    // card and getting the landscape one is the bug this guards.
    expect(tall.height).toBeGreaterThan(tall.width);

    await expect(page.getByText("Картинка билда скачана!")).toBeVisible();
  });
});

test.describe("Language switch", () => {
  test("English translates the page and leaves the build alone", async ({
    page,
  }) => {
    await page.goto("/?role=survivor");
    await expect(page.locator("[data-perk-card]").first()).toBeVisible();

    const russian = await boardPerks(page);
    expect(russian.join()).toMatch(/[А-Яа-я]/);
    const buildBefore = new URL(page.url()).searchParams.get("p");

    await page
      .getByRole("button", { name: "Switch language / Переключить язык" })
      .click();

    await expect(
      page.getByRole("button", { name: "Generate a new build" }),
    ).toBeVisible();
    // Chrome and data both have to switch: the buttons come from the i18n
    // dictionary, the perk names from the shipped data files.
    await expect
      .poll(() => boardPerks(page).then((p) => p.join()))
      .not.toMatch(/[А-Яа-я]/);

    // Language is a display concern; re-rolling while changing it would
    // throw away the build the visitor is looking at.
    expect(new URL(page.url()).searchParams.get("p")).toBe(buildBefore);

    // And the choice has to outlive the tab, or every visit fights the
    // browser's own locale again.
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Generate a new build" }),
    ).toBeVisible();

    await page
      .getByRole("button", { name: "Switch language / Переключить язык" })
      .click();
    await expect(
      page.getByRole("button", { name: "Сгенерировать новый билд" }),
    ).toBeVisible();
  });
});

test.describe("OBS overlay, fed by the real site", () => {
  test("a Browser Source opened mid-session shows the build already rolled, then follows it", async ({
    page,
    context,
  }) => {
    // The overlay had only ever been tested in its empty "waiting" state —
    // the one state that needs no data at all. This drives the real publish
    // path (the board writes, the overlay reads) from a second tab in the
    // same browser, which is how OBS's Browser Source sits alongside the
    // streamer's own window.
    await page.goto("/?role=survivor");
    await expect(page.locator("[data-perk-card]").first()).toBeVisible();
    const published = await boardPerks(page);
    expect(published.length).toBeGreaterThan(0);

    const overlay = await context.newPage();
    const overlayPerks = () =>
      overlay
        .locator("img[alt]")
        .evaluateAll((imgs) => imgs.map((i) => i.getAttribute("alt") ?? ""));
    await overlay.goto("/?obs=1");

    // Opening late must not mean waiting for the next roll — the last known
    // build is mirrored to storage for exactly this case.
    await expect
      .poll(() =>
        overlayPerks().then((names) => published.every((p) => names.includes(p))),
      )
      .toBe(true);
    await expect(
      overlay.getByText(/Ждём билд с основного сайта|Waiting for a build/),
    ).not.toBeVisible();

    // And it keeps up once it is open.
    await page
      .getByRole("button", { name: "Сгенерировать новый билд" })
      .click();
    await expect
      .poll(() => boardPerks(page).then((p) => p.join()))
      .not.toBe(published.join());
    const next = await boardPerks(page);
    await expect
      .poll(() =>
        overlayPerks().then((names) => next.every((p) => names.includes(p))),
      )
      .toBe(true);

    await overlay.close();
  });
});

test.describe("Shortcut discoverability", () => {
  test("each reroll button shows the digit that triggers it", async ({ page }) => {
    // The digit used to exist only in a title tooltip on a hover-revealed
    // button, so finding it took four steps and two delays. Drawing it in
    // the button is what makes the 1-4 hotkeys findable at all — and the
    // numbers have to match the slot order, or the hint teaches the wrong
    // key.
    await page.goto("/?role=survivor");
    await expect(page.locator("[data-perk-card]")).toHaveCount(4);

    const cards = page.locator("[data-perk-card]");
    const shown: string[] = [];
    for (let i = 0; i < 4; i++) {
      const button = cards.nth(i).getByRole("button", { name: "Перебросить этот перк" });
      // Hovering the card is what reveals the corner controls.
      await cards.nth(i).hover();
      await expect(button).toBeVisible();
      shown.push((await button.innerText()).trim());
    }
    expect(shown, "the digit drawn on each reroll button, left to right").toEqual([
      "1",
      "2",
      "3",
      "4",
    ]);
  });

  test("the digit shown on a slot is the key that rerolls that slot", async ({ page }) => {
    // Ties the label to the behaviour: pressing what slot 2 advertises has
    // to change slot 2 and leave the rest alone. A hint that names the
    // wrong key is worse than no hint.
    await page.goto("/?role=survivor");
    await expect(page.locator("[data-perk-card]")).toHaveCount(4);
    const before = await boardPerks(page);

    await page.locator("[data-perk-card]").nth(1).hover();
    const label = (
      await page
        .locator("[data-perk-card]")
        .nth(1)
        .getByRole("button", { name: "Перебросить этот перк" })
        .innerText()
    ).trim();
    expect(label).toBe("2");

    await page.locator("body").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press(`Digit${label}`);
    await expect.poll(() => boardPerks(page).then((p) => p[1])).not.toBe(before[1]);

    const after = await boardPerks(page);
    expect([after[0], after[2], after[3]]).toEqual([before[0], before[2], before[3]]);
  });

  test("the shortcut legend does not claim to be the complete list", async ({ page }) => {
    // It advertises Space/C/S. An incomplete list reads as a complete one,
    // which is why the digits are labelled on the controls instead of being
    // appended here — a legend grows with every shortcut, a label does not.
    await page.goto("/?role=survivor");
    await expect(page.locator("[data-perk-card]")).toHaveCount(4);
    const keys = await page.locator("kbd").allInnerTexts();
    expect(keys.map((k) => k.trim())).toEqual(["Space", "C", "S"]);
  });
});

test.describe("Role from the URL", () => {
  // `r` is the short parameter the site writes into every share link, so a
  // link that loses its `p=` — truncated by a chat client, shortened by
  // hand — still has to open the side it names. It used to be discarded
  // unless a build or an explicit mode came with it, which meant `?r=k`
  // quietly showed Survivor.
  for (const [url, expected] of [
    ["/?r=k", "убийцы"],
    ["/?r=s", "выжившего"],
    ["/?role=killer", "убийцы"],
    ["/?role=survivor", "выжившего"],
    ["/?r=k&mode=all", "убийцы"],
  ] as const) {
    test(`${url} opens ${expected}`, async ({ page }) => {
      await page.goto(url);
      await expect(page.locator("[data-perk-card]").first()).toBeVisible();
      await expect(page.locator("main")).toContainText(`для ${expected}`);
    });
  }

  test("a bare role is not treated as a shared build", async ({ page }) => {
    // Applying the role must not make the roll a fixed one: a shared build
    // hides the rerolls, and that would be a worse bug than the one fixed.
    await page.goto("/?r=k");
    await expect(page.locator("[data-perk-card]")).toHaveCount(4);
    await expect(
      page.getByRole("button", { name: "Перебросить этот перк" }).first(),
    ).toBeAttached();
    const before = await boardPerks(page);
    await page.getByRole("button", { name: "Сгенерировать новый билд" }).click();
    await expect.poll(() => boardPerks(page).then((p) => p.join())).not.toBe(before.join());
  });

  test("an unknown role is ignored rather than obeyed", async ({ page }) => {
    await page.goto("/?r=zzz");
    await expect(page.locator("[data-perk-card]").first()).toBeVisible();
    await expect(page.locator("main")).toContainText("для выжившего");
  });
});
