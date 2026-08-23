import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

/* The vortex baked into the share image.
 *
 * The claim worth testing is that the artwork belongs to the BUILD: the same
 * build always produces the same fog, a different build produces different
 * fog. Asserted on the generated data URI rather than on the exported file,
 * because the URI is the output of a pure function and is exactly stable,
 * while the rasterized card is not: html2canvas's text antialiasing jitters,
 * and two exports of one build were measured differing in 105 pixels out of
 * 5,760,000. Comparing files byte-for-byte therefore failed two runs in
 * three while nothing was wrong.
 */
const backdrops = (page: Page) =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll("img"))
      .map((i) => i.src)
      .filter((src) => src.startsWith("data:image/jpeg")),
  );

test("the fog belongs to the build", async ({ page }) => {
  await page.goto("/?role=killer");
  await expect(page.locator("[data-perk-card]")).toHaveCount(4);

  const first = await backdrops(page);
  expect(first.length, "no backdrop was generated for either card").toBe(2);
  expect(first[0].length, "the backdrop is suspiciously small").toBeGreaterThan(2000);

  // An unrelated re-render must not repaint it. The memo is keyed on the
  // build, and a fresh vortex on every render would mean the picture was not
  // really of anything.
  await page.getByRole("button", { name: /^Копировать$/ }).first().click();
  await page.waitForTimeout(300);
  expect(await backdrops(page), "an unrelated render changed the artwork").toEqual(first);

  await page.getByRole("button", { name: "Сгенерировать новый билд" }).click();
  await page.waitForTimeout(600);
  const after = await backdrops(page);
  expect(after[0], "a different build produced the same fog").not.toBe(first[0]);
  expect(after[1], "a different build produced the same story fog").not.toBe(first[1]);
});

test("a browser without WebGL still gets its picture", async ({ page }) => {
  /* Not a hypothetical: a blocked or exhausted GL context is ordinary, and
   * the card is composed to look finished without the fog. What must not
   * happen is the download failing because of it. */
  await page.addInitScript(() => {
    const real = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      if (type === "webgl" || type === "experimental-webgl" || type === "webgl2") return null;
      return (real as unknown as (...a: unknown[]) => unknown).call(this, type, ...rest);
    } as typeof HTMLCanvasElement.prototype.getContext;
  });
  await page.goto("/?role=survivor");
  await expect(page.locator("[data-perk-card]")).toHaveCount(4);
  expect(await backdrops(page), "WebGL was refused, so there should be no backdrop").toEqual([]);

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: /Скачать картинку/ }).click();
  await page.getByRole("menuitem", { name: /Стандартный/ }).click();
  const file = await (await download).path();
  expect(readFileSync(file!).length, "the download is empty").toBeGreaterThan(10_000);
});

test("the download stays a size someone can actually post", async ({ page }) => {
  /* This was 6.9 MB landscape and 9.8 MB story as PNG — the latter at
   * Discord's free-account limit, for an image no feed shows above 1600px.
   * Film grain is close to the worst case for PNG and the card has nothing
   * transparent, so it is a JPEG now. The budgets are what stop that
   * quietly reverting. */
  await page.goto("/?role=killer&mode=all");
  await expect(page.locator("[data-perk-card]")).toHaveCount(4);

  const grab = async (format: RegExp) => {
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: /Скачать картинку/ }).click();
    await page.getByRole("menuitem", { name: format }).click();
    const d = await download;
    expect(d.suggestedFilename()).toMatch(/\.jpg$/);
    return readFileSync((await d.path())!).length / 1024 / 1024;
  };

  const landscape = await grab(/Стандартный/);
  const story = await grab(/История/);
  console.log(`landscape ${landscape.toFixed(2)} MB · story ${story.toFixed(2)} MB`);
  expect(landscape, "the landscape export has ballooned").toBeLessThan(2);
  expect(story, "the story export has ballooned").toBeLessThan(3);
});
