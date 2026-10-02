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

const TRIGGER = /Режим, перки, персонаж, пулы, оверлей/;
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

/* Nothing inside the panel is parked outside its own box.
 *
 * A ControlPanel scrolls horizontally rather than wrapping, deliberately: its
 * segments are separated by a divider, and a divider inside a flex-wrap row
 * cannot know which visual line it landed on. The cost is that one segment too
 * many does not reflow, it leaves — and because every measurement taken while
 * reducing the board was of the COLLAPSED state, a switch sitting at x=1103 in
 * an 834px panel shipped unnoticed for a commit.
 *
 * This measures what someone opening the panel can actually reach, at the
 * widths where the row is most likely to overflow.
 */
for (const width of [1366, 1024, 768]) {
  test(`every control in the setup panel is reachable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/?role=survivor");
    const trigger = page.getByRole("button", { name: TRIGGER });
    if ((await trigger.getAttribute("aria-expanded")) === "false") await trigger.click();
    await expect(page.locator("#setup-panel")).toBeVisible();

    const clipped = await page.evaluate(() => {
      const out: string[] = [];
      for (const panel of document.querySelectorAll<HTMLElement>("#setup-panel .overflow-x-auto")) {
        if (panel.scrollWidth <= panel.clientWidth + 1) continue;
        const box = panel.getBoundingClientRect();
        for (const control of panel.querySelectorAll<HTMLElement>("button,[role=switch],[role=radio],select")) {
          const r = control.getBoundingClientRect();
          if (r.left >= box.left - 1 && r.right <= box.right + 1) continue;
          const label = control.textContent?.trim() || control.getAttribute("aria-label") || "(unlabelled)";
          out.push(`${label} — ${Math.round(r.left)}..${Math.round(r.right)} outside ${Math.round(box.left)}..${Math.round(box.right)}`);
        }
      }
      return out;
    });

    expect(clipped, `${clipped.length} controls sit outside their panel`).toEqual([]);
  });
}
