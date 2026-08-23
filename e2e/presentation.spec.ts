import { test, expect, type Page } from "@playwright/test";

/* The presentation picker changes how a roll is SHOWN, never what is rolled.
 *
 * That is the whole risk in the feature: a stage that generated its own perks
 * would look fine and quietly disagree with the build the share link, the OBS
 * overlay, the history and the copy buttons all describe. The invariant is
 * checked directly — switch presentation without rolling, and the names must
 * be identical. */

async function choose(page: Page, label: RegExp) {
  await page.getByTestId("presentation-picker").click();
  await page.getByRole("menuitemradio", { name: label }).click();
}

/** Perk names as the grid shows them. Read from the card's accessible name
 *  rather than its text: the first line of a card's innerText is the "1".."4"
 *  hotkey badge, not the perk. */
async function gridNames(page: Page) {
  const labels = await page.locator("[data-perk-card]").evaluateAll((els) =>
    els.map((el) => el.getAttribute("aria-label") ?? ""),
  );
  return labels.map((l) => l.replace(/^[^:]*:\s*/, "").trim());
}

/** Perk names a canvas stage exposes for screen readers — the only text it
 *  has, since the build itself is painted. */
async function stageNames(page: Page, testId: string) {
  return page.getByTestId(testId).locator("li").allInnerTexts();
}

/** The slugs a stage is really going to PAINT, published by the stage from
 *  the reels/hand it built.
 *
 *  Reading the sr-only list instead would prove nothing: that list is
 *  rendered straight from the props, so it agrees with the board by
 *  construction and stays correct even when the canvas draws something else
 *  entirely. Verified by deliberately making a reel pick its own symbol — the
 *  props-based check passed, this one fails. */
async function painted(page: Page, testId: string) {
  const raw = await page.getByTestId(testId).getAttribute("data-shown");
  return (raw ?? "").split(",").filter(Boolean);
}

/** Slugs of the build the board itself rolled, off the perk icons' paths. */
async function boardSlugs(page: Page) {
  return page.locator("[data-perk-card] img").evaluateAll((els) =>
    els.map((el) => (el as HTMLImageElement).src.split("/").pop()?.replace(/\.webp.*$/, "") ?? ""),
  );
}

test("classic is the default and shows the grid", async ({ page }) => {
  await page.goto("/?role=survivor");
  await expect(page.locator("[data-perk-card]")).toHaveCount(4);
  await expect(page.getByTestId("ritual-stage")).toHaveCount(0);
  await expect(page.getByTestId("slots-stage")).toHaveCount(0);
  await expect(page.getByTestId("presentation-picker")).toContainText("Обычный");
});

for (const [label, testId, name] of [
  [/Слоты/, "slots-stage", "slots"],
  [/Ритуал/, "ritual-stage", "ritual"],
] as const) {
  test(`${name} replaces the grid and shows the same build`, async ({ page }) => {
    await page.goto("/?role=killer");
    await expect(page.locator("[data-perk-card]")).toHaveCount(4);
    const before = await gridNames(page);
    const beforeSlugs = await boardSlugs(page);

    await choose(page, label);
    await expect(page.getByTestId(testId)).toBeVisible();
    // The grid is replaced, not merely hidden behind the stage.
    await expect(page.locator("[data-perk-card]")).toHaveCount(0);

    const shown = await stageNames(page, testId);
    expect(shown.length, "stage lists every rolled perk").toBe(before.length);
    // Switching presentation must not reroll: same build, different clothes.
    expect(shown.map((s) => s.trim())).toEqual(before);
    // And what it PAINTS is that same build, not merely what it announces.
    expect(await painted(page, testId), "canvas paints the rolled build").toEqual(
      beforeSlugs,
    );
  });
}

test("a roll in a stage still drives the rest of the page", async ({ page }) => {
  await page.goto("/?role=killer");
  await expect(page.locator("[data-perk-card]")).toHaveCount(4);
  await choose(page, /Слоты/);
  await expect(page.getByTestId("slots-stage")).toBeVisible();

  const before = await stageNames(page, "slots-stage");
  await page.getByRole("button", { name: "Сгенерировать новый билд" }).click();
  await expect.poll(() => stageNames(page, "slots-stage")).not.toEqual(before);

  // Back to classic without rolling: the grid must show what the stage showed.
  const after = await stageNames(page, "slots-stage");
  await choose(page, /Обычный/);
  await expect(page.locator("[data-perk-card]")).toHaveCount(4);
  const grid = (await gridNames(page)).map((s) => s.split("\n")[0].trim());
  expect(grid).toEqual(after.map((s) => s.trim()));
});

test("the choice survives a reload", async ({ page }) => {
  await page.goto("/?role=survivor");
  await expect(page.locator("[data-perk-card]")).toHaveCount(4);
  await choose(page, /Слоты/);
  await expect(page.getByTestId("slots-stage")).toBeVisible();

  await page.reload();
  await expect(page.getByTestId("slots-stage")).toBeVisible();
  await expect(page.getByTestId("presentation-picker")).toContainText("Слоты");
});
