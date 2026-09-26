import { test, expect, type Page } from "@playwright/test";

/* "Roll something new", driven the way a person drives it.
 *
 * What the unit tests cannot check is the wiring: that the button acts on
 * the role whose coverage bar it sits under, that the build it produces
 * actually reaches the board, and that pressing it moves the number it was
 * pressed because of.
 */

async function openStats(page: Page) {
  await expect.poll(() => page.locator("[data-perk-card]").count()).toBe(4);
  await page.getByRole("button", { name: "Ещё", exact: true }).click();
  await page.getByRole("button", { name: "Статистика", exact: true }).click();
}

const newButton = (page: Page) => page.getByRole("button", { name: "Выдать новое" });

async function build(page: Page) {
  const labels = await page
    .locator("[data-perk-card]")
    .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") ?? ""));
  return labels.length === 4 ? labels.map((l) => l.replace(/^[^:]*:\s*/, "").trim()) : [];
}

test("the button is offered beside the coverage bar and rolls a build", async ({ page }) => {
  await page.goto("/?role=survivor");
  await page.getByRole("button", { name: "Сгенерировать новый билд" }).click();
  await openStats(page);

  await expect(page.getByRole("progressbar", { name: "Открыто перков" })).toBeVisible();
  await expect(newButton(page)).toBeVisible();

  const before = await build(page);
  await newButton(page).click();

  // The modal gets out of the way and the board shows the new build.
  await expect(page.getByRole("progressbar", { name: "Открыто перков" })).toHaveCount(0);
  await expect.poll(async () => await build(page)).not.toEqual(before);
  expect(await build(page)).toHaveLength(4);
});

test("it says what it managed to do", async ({ page }) => {
  await page.goto("/?role=survivor");
  await page.getByRole("button", { name: "Сгенерировать новый билд" }).click();
  await openStats(page);
  await newButton(page).click();

  // A fresh visitor has seen at most a handful of the 176, so this is the
  // happy case and should say so rather than saying nothing.
  await expect(
    page.getByText("Билд целиком из перков, которые вам ещё не выпадали."),
  ).toBeVisible();
});

test("the perks it hands over are ones that had not come up", async ({ page }) => {
  await page.goto("/?role=survivor");
  await page.getByRole("button", { name: "Сгенерировать новый билд" }).click();
  const seenFirst = await build(page);

  await openStats(page);
  await newButton(page).click();
  await expect.poll(async () => (await build(page)).length).toBe(4);

  // Nothing from the build that was just recorded may reappear in a build
  // drawn specifically from what has never been recorded.
  for (const name of await build(page)) {
    expect(seenFirst).not.toContain(name);
  }
});

test("pressing it moves the number that prompted it", async ({ page }) => {
  await page.goto("/?role=survivor");
  await page.getByRole("button", { name: "Сгенерировать новый билд" }).click();
  await openStats(page);

  const bar = page.getByRole("progressbar", { name: "Открыто перков" });
  const before = Number(await bar.getAttribute("aria-valuenow"));
  await newButton(page).click();

  await openStats(page);
  await expect
    .poll(async () => Number(await bar.getAttribute("aria-valuenow")))
    .toBeGreaterThan(before);
});

test("it acts on the role whose coverage is being looked at", async ({ page }) => {
  // Open the board on survivor, switch the modal to killer, press the
  // button: the board has to come back on killer, or the number above the
  // button described one role and the build below it another.
  //
  // Both roles get rolled first because the modal shows its empty state for
  // a role with no history at all — there is no coverage bar to act on until
  // there is something to measure.
  await page.goto("/?role=killer");
  await expect.poll(() => page.locator("[data-perk-card]").count()).toBe(4);
  await page.getByRole("button", { name: "Сгенерировать новый билд" }).click();

  await page.goto("/?role=survivor");
  await page.getByRole("button", { name: "Сгенерировать новый билд" }).click();
  await openStats(page);

  // Scoped to the dialog: the board behind it has its own role switch with
  // the same label.
  await page.getByRole("dialog").getByRole("button", { name: "Убийца", exact: true }).click();
  await newButton(page).click();

  await expect.poll(() => page.url()).toContain("r=k");
  await expect.poll(async () => (await build(page)).length).toBe(4);
});

test("a visitor with no history sees the empty state, not a bare zero", async ({ page }) => {
  // The coverage bar and its button only exist once there is something to
  // measure; before that the modal explains itself instead of reading
  // "0 / 176" with no context.
  await page.goto("/?role=survivor");
  await expect.poll(() => page.locator("[data-perk-card]").count()).toBe(4);
  await page.evaluate(() => localStorage.removeItem("dbd-randomizer:stats"));
  await page.reload();
  await expect.poll(() => page.locator("[data-perk-card]").count()).toBe(4);

  await page.getByRole("button", { name: "Ещё", exact: true }).click();
  await page.getByRole("button", { name: "Статистика", exact: true }).click();
  await expect(page.getByText("Пока нет данных — сгенерируйте несколько билдов.")).toBeVisible();
  await expect(newButton(page)).toHaveCount(0);
});
