import { test, expect, type Page } from "@playwright/test";

/* The coherence dial, and the links it must not disturb.
 *
 * The risk here is not that the setting fails to work — that is measured in
 * lib/coherence.test.ts, over thousands of rolls, which a browser test could
 * never do honestly. The risk is that it leaks into the URL for people who
 * never touch it, or fails to travel for people who do. A seed at level 0 and
 * the same seed at level 3 are different builds, so a link that drops the
 * level reopens as something other than what was shared.
 */

const levelButton = (page: Page, name: string) =>
  page.getByRole("radio", { name, exact: true });

async function waitForBuild(page: Page) {
  await expect.poll(() => page.locator("[data-perk-card]").count()).toBe(4);
}

test("the control starts on Chaos and writes nothing into the link", async ({ page }) => {
  await page.goto("/?r=s");
  await waitForBuild(page);

  await expect(levelButton(page, "Хаос")).toHaveAttribute("aria-checked", "true");
  // The link has to stay byte-identical for anyone who leaves this alone —
  // bookmarks, the OBS overlay URL and every link already shared depend on
  // the format not growing a parameter nobody asked for.
  expect(page.url()).not.toContain("c=");
});

test("choosing a level puts it in the link and survives a reload", async ({ page }) => {
  await page.goto("/?r=s");
  await waitForBuild(page);

  await levelButton(page, "Синергия").click();
  await expect.poll(() => page.url()).toContain("c=3");

  await page.reload();
  await waitForBuild(page);
  await expect(levelButton(page, "Синергия")).toHaveAttribute("aria-checked", "true");
});

test("a link carrying a level opens on it", async ({ page }) => {
  await page.goto("/?r=s&c=2");
  await waitForBuild(page);
  await expect(levelButton(page, "Заметно")).toHaveAttribute("aria-checked", "true");
});

test("a shared seed reopens the same build, level and all", async ({ page }) => {
  // The point of carrying the level: without it this link would rebuild the
  // same seed at level 0 and show a different set of perks.
  await page.goto("/?r=s&seed=coherence-demo&c=3");
  await waitForBuild(page);
  const sent = await page
    .locator("[data-perk-card]")
    .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") ?? ""));

  await page.goto("about:blank");
  await page.goto("/?r=s&seed=coherence-demo&c=3");
  await waitForBuild(page);
  const reopened = await page
    .locator("[data-perk-card]")
    .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") ?? ""));
  expect(reopened).toEqual(sent);
});

test("a seeded build is the same for everyone, whatever their level", async ({ page }) => {
  /* The Daily Challenge's seed is derived locally rather than shared, so if
   * coherence weighted a seeded roll, two players taking the same challenge
   * would be handed different builds by a setting neither of them shared.
   * Seeded builds therefore ignore the level — see the comment on the
   * activeSeed branch in lib/use-roll-session.ts — and this is the test that
   * says so. The level still applies to the next Generate. */
  await page.goto("/?r=s&seed=coherence-demo&c=0");
  await waitForBuild(page);
  const chaos = await page
    .locator("[data-perk-card]")
    .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") ?? ""));

  await page.goto("about:blank");
  await page.goto("/?r=s&seed=coherence-demo&c=3");
  await waitForBuild(page);
  const synergy = await page
    .locator("[data-perk-card]")
    .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") ?? ""));

  expect(synergy).toEqual(chaos);
});

test("an old link with no level still opens exactly as it did", async ({ page }) => {
  await page.goto("/?r=s&p=28,3,297,72");
  await waitForBuild(page);
  await expect(levelButton(page, "Хаос")).toHaveAttribute("aria-checked", "true");
  expect(page.url()).toContain("p=28");
  expect(page.url()).not.toContain("c=");
});

test("a nonsense level in a link falls back to Chaos rather than breaking the board", async ({
  page,
}) => {
  await page.goto("/?r=s&c=99");
  await waitForBuild(page);
  await expect(levelButton(page, "Хаос")).toHaveAttribute("aria-checked", "true");
});

test("the control is not offered where it cannot apply", async ({ page }) => {
  await page.goto("/?r=s&mode=loadout");
  await expect(page.getByTestId("loadout-slot-item")).toBeVisible();
  // Loadout mode rolls no perks, so a perk-coherence dial there would be a
  // control that does nothing.
  await expect(levelButton(page, "Хаос")).toHaveCount(0);
});
