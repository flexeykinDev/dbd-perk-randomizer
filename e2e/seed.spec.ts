import { test, expect, type Page } from "@playwright/test";

/* The seed controls, driven the way a person drives them.
 *
 * The existing coverage in smoke.spec.ts arrives at a seed through the URL
 * (`?seed=…`) and checks that the build is deterministic. That leaves the
 * three paths a person actually clicks — typing a seed and setting it,
 * clearing one, and switching the Daily Challenge back off — with no coverage
 * at all, which is exactly the surface lib/use-seed.ts moved.
 *
 * Every one of them is a silent failure if it breaks: a seed that does not
 * take hold shows a perfectly plausible random build.
 */

/* Taking the Daily Challenge writes a +1 to a real, shared Firebase counter
   — the number the site shows as "сегодня сыграли N". A test run is not a
   player, and a CI run that toggles it three times would quietly inflate it,
   so the write is blocked here. Blocking also makes these tests hermetic:
   they no longer depend on a runner being able to reach Firebase at all. */
async function blockDailyCounterWrites(page: Page) {
  await page.route("**/*firebasedatabase.app/**", (route) => route.abort());
}

async function openMoreMenu(page: Page) {
  await expect.poll(() => page.locator("[data-perk-card]").count()).toBe(4);
  await page.getByRole("button", { name: "Ещё", exact: true }).click();
}

/** The build currently on the board, by the cards' accessible names.
 *
 *  Empty unless exactly four cards are mounted. AnimatePresence keeps the
 *  outgoing build on screen through its exit transition, so mid-roll there
 *  are eight — and a caller polling for "the build changed" would otherwise
 *  match that transient state instead of waiting for the new one. */
async function build(page: Page) {
  const labels = await page
    .locator("[data-perk-card]")
    .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") ?? ""));
  if (labels.length !== 4) return [];
  return labels.map((l) => l.replace(/^[^:]*:\s*/, "").trim());
}

const seedLine = (page: Page) => page.getByText(/Активный сид:/);

test("typing a seed and setting it pins the build to it", async ({ page }) => {
  await page.goto("/?role=survivor");
  await openMoreMenu(page);

  await page.getByLabel("Свой сид").fill("phase-two");
  await page.getByRole("button", { name: "Задать", exact: true }).click();

  await expect(seedLine(page)).toContainText("phase-two");
  await expect.poll(() => build(page)).toHaveLength(4);
  const pinned = await build(page);

  // Generate is disabled under a seed — the build is the seed's, not a roll.
  await expect(
    page.getByRole("button", { name: /Сгенерировать новый билд/ }),
  ).toBeDisabled();

  // And it is the same build a fresh visit to that seed produces, which is
  // the whole promise of a seed.
  await page.goto("/?role=survivor&seed=phase-two");
  await expect.poll(() => build(page)).toEqual(pinned);
});

test("Enter in the seed box does the same as clicking Set", async ({ page }) => {
  await page.goto("/?role=survivor");
  await openMoreMenu(page);

  await page.getByLabel("Свой сид").fill("via-enter");
  await page.getByLabel("Свой сид").press("Enter");

  await expect(seedLine(page)).toContainText("via-enter");
});

test("clearing a seed releases the build and rolls a fresh one", async ({ page }) => {
  await page.goto("/?role=survivor&seed=to-be-cleared");
  await expect(seedLine(page)).toContainText("to-be-cleared");
  await expect.poll(() => build(page)).toHaveLength(4);
  const seeded = await build(page);

  await page.getByRole("button", { name: "Ещё", exact: true }).click();
  await page.getByRole("button", { name: "Сбросить сид" }).click();

  // The seed is gone from the page and from the URL.
  await expect(seedLine(page)).toHaveCount(0);
  await expect(page).not.toHaveURL(/[?&]seed=/);

  /* The board moves off the seed's build rather than leaving it sitting
     there unpinned, which would make "clear" look like it did nothing.
     Note this does NOT pin down the reroll specifically: dropping the seed
     alone re-runs the roll memo, so the build changes either way. */
  await expect.poll(() => build(page)).not.toEqual(seeded);
  await expect(
    page.getByRole("button", { name: /Сгенерировать новый билд/ }),
  ).toBeEnabled();
});

test("the Daily Challenge toggles back off", async ({ page }) => {
  await blockDailyCounterWrites(page);
  await page.goto("/?role=survivor");
  await openMoreMenu(page);

  const daily = page.getByRole("button", { name: "Задание дня", exact: true });
  await daily.click();
  await expect(seedLine(page)).toContainText(/\d{4}-\d{2}-\d{2}-survivor/);

  /* Off again through the same button. The menu stays open after a pick, so
     this does NOT reopen it first — clicking "Ещё" again would close it and
     take the button with it. This path used to call clearSeed(); it is its
     own branch in the hook now, so it is worth its own assertion. */
  await expect(daily).toBeVisible();
  await daily.click();
  await expect(seedLine(page)).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /Сгенерировать новый билд/ }),
  ).toBeEnabled();
});

test("switching role under the Daily Challenge follows the new role", async ({ page }) => {
  /* The daily seed is derived from the role rather than stored, so this is
     the case a stored copy would get wrong — the seed line would keep saying
     "-survivor" while the board rolled killer perks. */
  await blockDailyCounterWrites(page);
  await page.goto("/?role=survivor");
  await openMoreMenu(page);
  await page.getByRole("button", { name: "Задание дня", exact: true }).click();
  await expect(seedLine(page)).toContainText("-survivor");

  await page.getByRole("button", { name: "Убийца", exact: true }).click();
  await expect(seedLine(page)).toContainText("-killer");
});
