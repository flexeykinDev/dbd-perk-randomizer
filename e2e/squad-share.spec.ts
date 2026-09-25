import { test, expect, type Page } from "@playwright/test";

/* Squad links, and the older links they must not disturb.
 *
 * Both halves matter equally. A squad link that does not reopen the squad is
 * a broken feature; a single-build link that stops working is a broken
 * promise to every link already sent, which is the worse of the two and the
 * reason the first test here is about the format that already existed.
 *
 * Driven through the real URL rather than the toggle where possible: a link
 * is the thing under test, and it is also the only part of this feature a
 * stranger ever touches.
 */

/** The build cards inside one player's section, by accessible name. */
async function playerBuild(page: Page, player: number) {
  const section = page.locator("section").filter({ hasText: `Игрок ${player}` });
  const labels = await section
    .locator("[data-perk-card]")
    .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") ?? ""));
  return labels.map((l) => l.replace(/^[^:]*:\s*/, "").trim());
}

async function squadSections(page: Page) {
  return page.locator("section").filter({ hasText: /^Игрок \d/ }).count();
}

test("an old single-build link still opens exactly the build it names", async ({ page }) => {
  // The format the site has written since short ids existed. Nothing about
  // squads may change what this does.
  await page.goto("/?r=s&p=28,3,297,72");

  await expect.poll(() => page.locator("[data-perk-card]").count()).toBe(4);
  expect(await squadSections(page)).toBe(0);

  const labels = await page
    .locator("[data-perk-card]")
    .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") ?? ""));
  expect(labels).toHaveLength(4);
  // And the link is still the one that was opened, not rewritten into a
  // squad link behind the visitor's back.
  expect(page.url()).toContain("p=28");
  expect(page.url()).not.toContain("sq=");
});

test("a legacy full-slug link still works too", async ({ page }) => {
  await page.goto("/?role=survivor&perks=adrenaline,resilience,lithe,kindred");
  await expect.poll(() => page.locator("[data-perk-card]").count()).toBe(4);
  expect(await squadSections(page)).toBe(0);
});

test("a squad link opens one build per player", async ({ page }) => {
  // Three players, two perks each — deliberately not four-of-four, so a
  // hard-coded lobby size would fail here.
  await page.goto("/?r=s&sq=28,3.297,72.15,9");

  await expect.poll(() => squadSections(page)).toBe(3);
  expect(await playerBuild(page, 1)).toHaveLength(2);
  expect(await playerBuild(page, 2)).toHaveLength(2);
  expect(await playerBuild(page, 3)).toHaveLength(2);

  // No perk twice across the squad — the whole promise of the mode.
  const all = [
    ...(await playerBuild(page, 1)),
    ...(await playerBuild(page, 2)),
    ...(await playerBuild(page, 3)),
  ];
  expect(new Set(all).size).toBe(all.length);
});

test("a squad link survives a reload unchanged", async ({ page }) => {
  await page.goto("/?r=s&sq=28,3.297,72.15,9");
  await expect.poll(() => squadSections(page)).toBe(3);
  const before = await playerBuild(page, 2);

  await page.reload();
  await expect.poll(() => squadSections(page)).toBe(3);
  expect(await playerBuild(page, 2)).toEqual(before);
});

test("rolling a squad writes a link that reopens it", async ({ page }) => {
  await page.goto("/?r=s");
  await page.getByRole("switch", { name: "Билды на группу" }).click();
  await page.getByRole("button", { name: "Сгенерировать новый билд" }).click();

  await expect.poll(() => squadSections(page)).toBe(4);
  const rolled = await Promise.all([1, 2, 3, 4].map((i) => playerBuild(page, i)));

  // The address bar is what the Share button copies, so that is what is
  // checked here rather than the clipboard.
  await expect.poll(() => page.url()).toContain("sq=");
  const link = page.url();

  await page.goto(link);
  await expect.poll(() => squadSections(page)).toBe(4);
  const reopened = await Promise.all([1, 2, 3, 4].map((i) => playerBuild(page, i)));
  expect(reopened).toEqual(rolled);
});

test("a squad link with a dead id opens with the players that survive", async ({ page }) => {
  // 99999999 is not an id anything maps to. The middle player loses their
  // whole build and drops out; the other two still open.
  await page.goto("/?r=s&sq=28,3.99999999.15,9");
  await expect.poll(() => squadSections(page)).toBe(2);
  expect(await playerBuild(page, 1)).toHaveLength(2);
  expect(await playerBuild(page, 2)).toHaveLength(2);
});
