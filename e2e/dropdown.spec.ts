import { test, expect } from "@playwright/test";

/* The custom dropdown that replaced the four native selects.
 *
 * The reason it is portalled is the reason for the second test: three of the
 * four sit inside modals that scroll their own content, where an absolutely
 * positioned panel is clipped by the ancestor's overflow and the bottom of
 * the list is simply unreachable. A native select never had that problem
 * because the OS drew it outside the page.
 */

test("picking from a dropdown changes the value", async ({ page }) => {
  await page.goto("/?role=killer");
  await expect(page.locator("[data-perk-card]")).toHaveCount(4);

  const trigger = page.getByRole("button", { name: "Тема билда" });
  await expect(trigger).toContainText("Любая");
  await trigger.click();

  const list = page.getByRole("listbox", { name: "Тема билда" });
  await expect(list).toBeVisible();
  const options = list.getByRole("option");
  await expect(options.first()).toBeVisible();

  const second = options.nth(1);
  const chosen = (await second.textContent())?.trim() ?? "";
  expect(chosen.length).toBeGreaterThan(0);
  await second.click();

  await expect(list).toBeHidden();
  await expect(trigger).toContainText(chosen);
});

test("keyboard alone can open and choose", async ({ page }) => {
  await page.goto("/?role=killer");
  await expect(page.locator("[data-perk-card]")).toHaveCount(4);

  const trigger = page.getByRole("button", { name: "Тема билда" });
  await trigger.focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("listbox", { name: "Тема билда" })).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("listbox", { name: "Тема билда" })).toBeHidden();
  // Focus returns to the trigger, or the next Tab starts from the top of the
  // page instead of where the person was.
  await expect(trigger).toBeFocused();
});

test("several characters can be filtered at once, and the list is not clipped", async ({
  page,
}) => {
  await page.goto("/?role=killer&mode=loadout");
  await expect.poll(() => page.locator("[data-piece-slug]").count()).toBeGreaterThan(2);
  await page.getByRole("button", { name: /^Пул( \d+)?$/ }).click();
  await expect(page.getByText("Настроить пул экипировки")).toBeVisible();

  const trigger = page.getByTestId("character-filter");
  await expect(trigger).toContainText("Персонаж…");
  await trigger.click();

  const list = page.getByRole("listbox", { name: "Фильтр по персонажу" });
  await expect(list).toBeVisible();

  // The panel must be fully on screen. Clipping was invisible to every other
  // assertion here — the options exist in the DOM either way.
  const box = await list.boundingBox();
  const viewport = page.viewportSize()!;
  expect(box).not.toBeNull();
  expect(box!.y, "panel starts above the viewport").toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height, "panel runs off the bottom").toBeLessThanOrEqual(viewport.height + 1);

  const options = list.getByRole("option");
  await options.nth(0).click();
  // Still open: choosing a second without reopening is the whole point.
  await expect(list).toBeVisible();
  await options.nth(1).click();
  await expect(trigger).toHaveAttribute("data-selected-count", "2");

  // Escape must close the dropdown WITHOUT closing the modal behind it.
  await page.keyboard.press("Escape");
  await expect(list).toBeHidden();
  await expect(page.getByText("Настроить пул экипировки")).toBeVisible();

  // And the filter is real — two characters show more pieces than one.
  const twoChars = await page.locator('div.fixed.inset-0 [role="button"]:has(img)').count();
  await trigger.click();
  await list.getByRole("option").nth(1).click();
  await page.keyboard.press("Escape");
  const oneChar = await page.locator('div.fixed.inset-0 [role="button"]:has(img)').count();
  expect(twoChars, "deselecting a character did not narrow the list").toBeGreaterThan(oneChar);
});

test("typing jumps to a match, the way the native select did", async ({ page }) => {
  /* The killer roster is forty-odd names. Replacing the native select left
   * arrow keys as the only way through it, which quietly removed a
   * capability rather than adding one.
   *
   * Driven in English on purpose: Playwright's keyboard dispatches no
   * keydown at all for characters outside the layout, so typing a Cyrillic
   * name reaches the page as an input event with no key -- the handler under
   * test would never run and the test would pass or fail for the wrong
   * reason. The behaviour is not language-specific. */
  await page.addInitScript(() =>
    localStorage.setItem("dbd-randomizer:language", "en"),
  );
  await page.goto("/?role=killer&mode=loadout");
  await expect.poll(() => page.locator("[data-piece-slug]").count()).toBeGreaterThan(2);
  await page.getByRole("button", { name: /^Pool( \d+)?$/ }).click();
  const trigger = page.getByTestId("character-filter");
  await expect(trigger).toBeVisible();
  await trigger.click();
  const list = page.getByRole("listbox", { name: "Filter by character" });
  await expect(list).toBeVisible();

  const labels = await list.getByRole("option").evaluateAll((els) =>
    els.map((e) => (e.textContent ?? "").trim()),
  );
  // A letter at least two options share, so the search is doing something a
  // single arrow press would not.
  const letter = labels
    .map((l) => l[0])
    .find((c, _, all) => all.filter((x) => x === c).length > 1)!;
  expect(letter, "no two characters share a first letter").toBeTruthy();

  const activeLabel = async () => {
    const id = await list.getAttribute("aria-activedescendant");
    return (await page.locator(`[id="${id}"]`).textContent())?.trim();
  };

  await page.keyboard.press(letter.toUpperCase());
  const first = await activeLabel();
  expect(
    first?.toLocaleLowerCase().startsWith(letter.toLocaleLowerCase()),
    `typing "${letter}" landed on "${first}"`,
  ).toBe(true);

  // Typing it again walks to the next match rather than sticking.
  await page.keyboard.press(letter.toUpperCase());
  const second = await activeLabel();
  expect(second, "repeating the letter stayed on the same option").not.toBe(first);
  expect(second?.toLocaleLowerCase().startsWith(letter.toLocaleLowerCase())).toBe(true);

  // And Enter takes the highlighted one.
  await page.keyboard.press("Enter");
  await expect(trigger).toHaveAttribute("data-selected-count", "1");
});
