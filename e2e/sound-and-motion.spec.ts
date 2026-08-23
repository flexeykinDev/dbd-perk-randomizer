import { test, expect, type Page } from "@playwright/test";

/* Sound, the loadout reveal, and the OBS entrance.
 *
 * Audio cannot be heard from a test, so what is checked is everything around
 * it that CAN go wrong silently: that nothing is constructed before a user
 * gesture (browsers block it, and a suspended context left lying around is a
 * real leak), that the setting persists, that muting actually stops the
 * engine being touched, and that the control is reachable. The waveform
 * itself is a judgement call and belongs to a person with speakers.
 */

/** Counts AudioContexts the page constructs, from before any script runs. */
async function countAudioContexts(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as {
      __ctxCount: number;
      AudioContext: typeof AudioContext;
    };
    w.__ctxCount = 0;
    const Real = w.AudioContext;
    // Deliberately shadowing the constructor so every construction is counted.
    w.AudioContext = class extends Real {
      constructor(...args: ConstructorParameters<typeof AudioContext>) {
        super(...args);
        w.__ctxCount++;
      }
    } as unknown as typeof AudioContext;
  });
}


/** Sound belongs to the slot machine now, so every sound test starts there. */
async function chooseSlots(page: Page) {
  await page.getByTestId("presentation-picker").click();
  await page.getByRole("menuitemradio", { name: /Слоты/ }).click();
  await expect(page.getByTestId("presentation-picker")).toContainText("Слоты");
}

test("no audio context exists until something is played", async ({ page }) => {
  await countAudioContexts(page);
  await page.goto("/?role=survivor");
  await expect(page.locator("[data-perk-card]")).toHaveCount(4);
  await chooseSlots(page);
  // Loading the page is not a gesture, and constructing a context without one
  // leaves it suspended forever.
  expect(await page.evaluate(() => (window as never as { __ctxCount: number }).__ctxCount)).toBe(0);

  await page.getByRole("button", { name: "Сгенерировать новый билд" }).click();
  await expect
    .poll(() => page.evaluate(() => (window as never as { __ctxCount: number }).__ctxCount))
    .toBeGreaterThan(0);
});

test("muting stops the engine being touched at all", async ({ page }) => {
  await countAudioContexts(page);
  await page.goto("/?role=survivor");
  await expect(page.locator("[data-perk-card]")).toHaveCount(4);

  await chooseSlots(page);
  await page.getByTestId("sound-control").click();
  await page.getByTestId("sound-mute").click();
  await expect(page.getByTestId("sound-control")).toHaveAttribute("data-muted", "1");
  const afterMute = await page.evaluate(
    () => (window as never as { __ctxCount: number }).__ctxCount,
  );

  await page.getByRole("button", { name: "Сгенерировать новый билд" }).click();
  await page.keyboard.press("2");
  await page.waitForTimeout(500);
  expect(
    await page.evaluate(() => (window as never as { __ctxCount: number }).__ctxCount),
    "a muted site still built an audio graph",
  ).toBe(afterMute);
});

test("the sound choice survives a reload", async ({ page }) => {
  await page.goto("/?role=survivor");
  await expect(page.locator("[data-perk-card]")).toHaveCount(4);
  await chooseSlots(page);
  await page.getByTestId("sound-control").click();
  await page.getByTestId("sound-mute").click();
  await expect(page.getByTestId("sound-control")).toHaveAttribute("data-muted", "1");

  await page.reload();
  // The presentation persists too, so the control comes back with the page —
  // waiting on the perk grid would wait forever, the slot stage replaces it.
  await expect(page.getByTestId("presentation-picker")).toContainText("Слоты");
  await expect(page.getByTestId("sound-control")).toHaveAttribute("data-muted", "1");
});

test("volume is a real control, and muting disables it", async ({ page }) => {
  await page.goto("/?role=survivor");
  await expect(page.locator("[data-perk-card]")).toHaveCount(4);
  await chooseSlots(page);
  await page.getByTestId("sound-control").click();

  const slider = page.getByTestId("sound-volume");
  await expect(slider).toBeEnabled();
  await slider.fill("60");
  await page.getByTestId("sound-mute").click();
  // Nothing to set the level of while it is off.
  await expect(slider).toBeDisabled();

  await page.getByTestId("sound-mute").click();
  await expect(slider).toBeEnabled();
  await expect(slider).toHaveValue("60");
});

test("the OBS entrance is a choice, and it reaches the overlay URL", async ({ page }) => {
  await page.goto("/?role=killer");
  await expect(page.locator("[data-perk-card]")).toHaveCount(4);
  await page.getByRole("button", { name: /Оверлей OBS/ }).click();
  await expect(page.getByRole("dialog")).toBeVisible();

  // Default carries no param — a URL already pasted into OBS keeps working.
  const field = page.getByTestId("obs-overlay-url");
  await expect(field).not.toContainText("anim=");

  await page.getByTestId("obs-entrance-flip").click();
  await expect(page.getByTestId("obs-entrance-flip")).toHaveAttribute("aria-checked", "true");
  await expect(field).toContainText("anim=flip");

  await page.getByTestId("obs-entrance-none").click();
  await expect(field).toContainText("anim=none");

  // Back to the default and the param goes away again rather than pinning it.
  await page.getByTestId("obs-entrance-rise").click();
  await expect(field).not.toContainText("anim=");
});

test("the loadout row reveals slot by slot", async ({ page }) => {
  await page.goto("/?role=killer&mode=loadout");
  await expect(page.getByTestId("loadout-slot-power")).toBeVisible();
  await page.waitForTimeout(600);

  /* Sampled across the whole reveal rather than at one instant.
   *
   * A single sample is a race: the stagger is real but brief, and reading it
   * 90ms in caught every slot at a transform that rounded to the same value.
   * Polling for "at some point during the reveal, the slots were not in the
   * same place" is the claim actually being made. */
  await page.getByRole("button", { name: "Сгенерировать новый билд" }).click();
  const sample = () =>
    page.evaluate(() =>
      Array.from(document.querySelectorAll("[data-piece-kind]"))
        .map((el) => getComputedStyle(el as HTMLElement).transform)
        .join("|"),
    );

  let sawStagger = false;
  let count = 0;
  for (let i = 0; i < 24 && !sawStagger; i++) {
    const frame = await sample();
    const parts = frame.split("|");
    count = Math.max(count, parts.length);
    if (new Set(parts).size > 1) sawStagger = true;
    await page.waitForTimeout(25);
  }

  expect(count, "loadout pieces present").toBeGreaterThan(1);
  expect(
    sawStagger,
    "every slot animated in lockstep — the stagger is not applying",
  ).toBe(true);
});
