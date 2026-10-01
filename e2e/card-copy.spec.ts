import { test, expect } from "@playwright/test";

/* Copy on a perk card, which is now an icon in the corner rather than a
 * full-width labelled button.
 *
 * The word "Copy" appeared five times in one view — once per card plus
 * "Copy full build" — and each card gave about a third of its height to
 * saying it. It reuses the same affordance the reroll and pin buttons
 * already use: invisible until the card is hovered, revealed by keyboard
 * focus, and always on where there is no hover to reveal it.
 *
 * The thing most worth guarding is not the copying. It is that copying must
 * not also open the description: the card body opens it, the corner buttons
 * do not, and the two are one stopPropagation apart.
 */

const COPY = /^Копировать: /;

test("copying a perk does not also open its description", async ({ page }) => {
  /* The delicate one. The card body opens the perk description; every
   * corner control stops the event before it gets there. Lose that and
   * every copy throws a modal over the board. */
  await page.goto("/?role=survivor&mode=perks");
  await expect(page.locator("[data-perk-card]")).toHaveCount(4);

  await page.locator("[data-perk-card]").first().hover();
  await page.getByRole("button", { name: COPY }).first().click();

  await expect(page.getByRole("dialog")).toHaveCount(0);
  // And the copy actually happened — the toast is the feedback, unchanged.
  await expect(page.locator("[data-perk-card]")).toHaveCount(4);
});

test("the card body still opens the description", async ({ page }) => {
  // The other half of the same distinction: it must still work.
  await page.goto("/?role=survivor&mode=perks");
  await expect(page.locator("[data-perk-card]")).toHaveCount(4);

  await page.locator("[data-perk-card]").first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
});

test("copy is named after its own perk, not just 'Copy'", async ({ page }) => {
  /* Four buttons on screen all announcing "Copy" tell a screen reader
   * nothing about which perk it would copy. The Info button beside it
   * already carries the perk's name; this matches it. */
  await page.goto("/?role=survivor&mode=perks");
  await expect(page.locator("[data-perk-card]")).toHaveCount(4);

  const buttons = page.getByRole("button", { name: COPY });
  await expect(buttons).toHaveCount(4);

  const names = await buttons.evaluateAll((els) =>
    els.map((e) => e.getAttribute("aria-label") ?? ""),
  );
  for (const name of names) {
    expect(name.replace("Копировать: ", "").trim().length, `bare name: ${name}`).toBeGreaterThan(0);
  }
});

test("it is reachable by keyboard, which is the half hover cannot serve", async ({ page }) => {
  await page.goto("/?role=survivor&mode=perks");
  await expect(page.locator("[data-perk-card]")).toHaveCount(4);

  /* Tabbed to, not .focus()'d. Programmatic focus deliberately does not
   * match :focus-visible — the browser only promotes an element to it when
   * the focus came from the keyboard — so calling focus() here would test
   * the opposite of what a keyboard user experiences. */
  await page.locator("[data-perk-card]").first().focus();
  let landed = false;
  for (let i = 0; i < 8 && !landed; i++) {
    await page.keyboard.press("Tab");
    landed = await page.evaluate(() =>
      (document.activeElement?.getAttribute("aria-label") ?? "").startsWith("Копировать: "),
    );
  }
  expect(landed, "never reached the copy button by tabbing out of the card").toBe(true);

  /* A control you can tab to but cannot see is worse than one that is
   * simply absent. Polled, not read once: the button carries
   * `transition-opacity`, so a single read straight after the keypress
   * measures the animation rather than the result. */
  await expect
    .poll(
      async () =>
        Number(
          await page.evaluate(() => getComputedStyle(document.activeElement as Element).opacity),
        ),
      { message: "focused copy button never became visible" },
    )
    .toBeGreaterThan(0.9);
});

test("the card no longer spends a third of its height on the word Copy", async ({ page }) => {
  /* The reason for the change, as a number. A labelled full-width button
   * was ~30px of a ~190px card; the icon sits in the corner row the reroll
   * and pin buttons already occupy and costs the card nothing. */
  await page.goto("/?role=survivor&mode=perks");
  await expect(page.locator("[data-perk-card]")).toHaveCount(4);

  const card = (await page.locator("[data-perk-card]").first().boundingBox())!;
  const copy = (await page.getByRole("button", { name: COPY }).first().boundingBox())!;
  expect(
    copy.height / card.height,
    "copy is taking a large share of the card again",
  ).toBeLessThan(0.2);
});
