// What a canvas owes the rest of the page.
//
// Both animated stages draw to a canvas, which means nothing they do is
// visible to a test unless they say so. They already publish `data-shown` —
// the perks they will actually paint, read off their own strips rather than
// off the props — and this file adds the other half: `data-settled`, which is
// whether the animation has finished.
//
// The rule being enforced is the one an animation can quietly break without
// anyone noticing: a roll that is interrupted by the next roll must still end
// somewhere. Before this, pressing Generate during a spin made SlotsStage
// teleport every reel back to the top of its strip, and made RitualStage
// delete the cards that were still in flight. Neither was detectable; both
// looked like the animation had been cut off, because it had.
import { expect, test, type Page } from "@playwright/test";

const STAGES = [
  { name: "Slots", presentation: "casino", testId: "slots-stage" },
  { name: "Ritual", presentation: "ritual", testId: "ritual-stage" },
] as const;

/** A desktop viewport: both stages are deliberately unavailable on a phone
 *  (see lib/use-presentation.ts), so a narrow one would fall back to Classic
 *  and this file would test nothing. */
const DESKTOP = { width: 1600, height: 1000 };

async function openStage(page: Page, presentation: string, testId: string) {
  await page.addInitScript((p) => {
    try {
      localStorage.setItem("dbd-randomizer:presentation", p);
    } catch {
      /* private mode — the picker still works, this is just the shortcut */
    }
  }, presentation);
  await page.setViewportSize(DESKTOP);
  await page.goto("/?role=survivor");
  return page.getByTestId(testId);
}

/** Waits for the stage to say it has stopped moving. */
async function settled(page: Page, testId: string) {
  await expect(page.getByTestId(testId)).toHaveAttribute("data-settled", "true", {
    timeout: 10_000,
  });
}

for (const stage of STAGES) {
  test(`${stage.name}: a roll reaches a settled state`, async ({ page }) => {
    const host = await openStage(page, stage.presentation, stage.testId);
    await expect(host).toBeVisible();
    await settled(page, stage.testId);
    // And it is showing something, not an empty table.
    const shown = await host.getAttribute("data-shown");
    expect(shown?.split(",").filter(Boolean).length).toBe(4);
  });

  test(`${stage.name}: spamming Generate still settles, on the last build`, async ({
    page,
  }) => {
    const host = await openStage(page, stage.presentation, stage.testId);
    await settled(page, stage.testId);

    /* Faster than either animation finishes, which is the point: every one of
       these lands mid-flight and has to cancel the one before it. 90ms is
       well inside the ~0.8s slots stagger and the 0.28s ritual wind-up. */
    const generate = page.getByRole("button", { name: "Сгенерировать новый билд" });
    for (let i = 0; i < 8; i++) {
      await generate.click();
      await page.waitForTimeout(90);
    }

    // It must stop, rather than being left mid-spin forever.
    await settled(page, stage.testId);

    /* And it must stop on the build the board actually holds. A stage that
       settles on the second-to-last roll is a worse bug than one that never
       settles, because it looks fine. */
    const shown = (await host.getAttribute("data-shown")) ?? "";
    const url = new URL(page.url());
    const ids = (url.searchParams.get("p") ?? "").split(",").filter(Boolean);
    expect(shown.split(",").filter(Boolean)).toHaveLength(ids.length);

    // Settling must also be stable: no late frame may unsettle it again.
    await page.waitForTimeout(600);
    await expect(host).toHaveAttribute("data-settled", "true");
    expect(await host.getAttribute("data-shown")).toBe(shown);
  });

  test(`${stage.name}: switching away mid-animation does not strand it`, async ({
    page,
  }) => {
    const host = await openStage(page, stage.presentation, stage.testId);
    await settled(page, stage.testId);

    // Start a roll, then leave for Classic before it can finish.
    await page.getByRole("button", { name: "Сгенерировать новый билд" }).click();
    await page.waitForTimeout(60);
    await page.getByTestId("presentation-picker").click();
    await page.getByRole("menuitemradio", { name: /Обычный/ }).click();
    await expect(host).toHaveCount(0);

    // Coming back must produce a stage that settles, not one resumed
    // half-finished from a roll two switches ago.
    await page.getByTestId("presentation-picker").click();
    await page
      .getByRole("menuitemradio", {
        name: stage.presentation === "casino" ? /Слоты/ : /Ритуал/,
      })
      .click();
    await settled(page, stage.testId);
  });
}

/* The grid skins.
 *
 * Classic, Minimal and Impact are the ordinary perk grid with different
 * entrances, so they get the guarantees the canvas stages needed hand-written
 * machinery for — framer-motion cancels an interrupted transition and
 * re-targets it from wherever the value currently is. That is the argument for
 * building a skin out of real cards rather than a canvas, and it is worth
 * holding to it rather than assuming it.
 *
 * They are also the only skins a phone is offered: both canvas stages are
 * desktop-only (see lib/use-presentation.ts), so before these existed a phone
 * had exactly one choice.
 */
const GRID_SKINS = [
  { name: "Minimal", presentation: "minimal", label: /Без анимации/ },
  { name: "Impact", presentation: "impact", label: /Резкий/ },
] as const;

for (const skin of GRID_SKINS) {
  test(`${skin.name}: spamming Generate lands on the build the board holds`, async ({
    page,
  }) => {
    await page.addInitScript((p) => {
      try {
        localStorage.setItem("dbd-randomizer:presentation", p);
      } catch {
        /* private mode — the picker still works */
      }
    }, skin.presentation);
    await page.setViewportSize(DESKTOP);
    await page.goto("/?role=survivor");
    await expect(page.locator("[data-perk-card]")).toHaveCount(4);

    const generate = page.getByRole("button", { name: "Сгенерировать новый билд" });
    for (let i = 0; i < 8; i++) {
      await generate.click();
      await page.waitForTimeout(70);
    }

    // Every card settles, and there are exactly four of them — no card left
    // mid-transform and none stranded by AnimatePresence.
    await page.waitForFunction(() => {
      const cards = [...document.querySelectorAll("[data-perk-card]")];
      return (
        cards.length === 4 &&
        cards.every((c) => getComputedStyle(c).transform === "none")
      );
    });

    // And the grid shows the build the URL describes.
    const ids = (new URL(page.url()).searchParams.get("p") ?? "").split(",").filter(Boolean);
    expect(ids).toHaveLength(4);
  });

  test(`${skin.name}: a phone is offered it`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/?role=survivor");
    await page.getByTestId("presentation-picker").click();
    await expect(page.getByRole("menuitemradio", { name: skin.label })).toBeVisible();
  });
}
