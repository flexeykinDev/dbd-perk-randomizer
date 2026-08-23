import { test, expect, type Page } from "@playwright/test";

/* Does the site actually make a sound?
 *
 * Everything in sound-and-motion.spec.ts checks the machinery AROUND the
 * audio — that a context is not built before a gesture, that muting works,
 * that the setting persists. None of it would notice the engine emitting
 * silence, and it did exactly that twice: once when Number(null) hydrated the
 * volume to zero, and once when a DynamicsCompressor turned every cue down by
 * 14dB. Both looked perfectly healthy from the outside.
 *
 * So this taps whatever reaches the speakers and measures it. It cannot say a
 * cue sounds GOOD — that needs a person — but it can say it exists, that it
 * is not clipping, and that muting really is silence rather than something
 * quiet.
 */
async function tapOutput(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    const origConnect = AudioNode.prototype.connect;
    (AudioNode.prototype as unknown as { connect: unknown }).connect = function (
      this: AudioNode,
      target: AudioNode,
      ...rest: unknown[]
    ) {
      if (String(target?.constructor?.name ?? "").includes("Destination") && !w.__tapped) {
        w.__tapped = 1;
        /* A deliberately huge window. At 2048 samples the analyser holds
         * ~42ms of audio, so catching a cue's peak depended on a JS timer
         * firing inside that window — fine alone, and flaky under parallel
         * workers where timers are throttled and the browser is serialising
         * GPU work. 32768 samples is ~0.7s, so a single read covers the whole
         * cue and the sampling rate stops mattering. */
        const analyser = (this.context as AudioContext).createAnalyser();
        analyser.fftSize = 32768;
        const buf = new Float32Array(32768);
        (origConnect as unknown as (...a: unknown[]) => unknown).call(this, analyser);
        setInterval(() => {
          analyser.getFloatTimeDomainData(buf);
          for (const v of buf) w.__peak = Math.max(w.__peak as number, Math.abs(v));
        }, 25);
      }
      return (origConnect as unknown as (...a: unknown[]) => unknown).call(this, target, ...rest);
    };
    w.__peak = 0;
    // Sampling must already be running before the gesture: reading a peak
    // after a round-trip measures the tail of a sound that has ended.
    w.__arm = () => {
      w.__peak = 0;
    };
  });
}

async function chooseSlots(page: Page) {
  await page.getByTestId("presentation-picker").click();
  await page.getByRole("menuitemradio", { name: /Слоты/ }).click();
  await expect(page.getByTestId("presentation-picker")).toContainText("Слоты");
}

const arm = (page: Page) => page.evaluate(() => (window as unknown as { __arm(): void }).__arm());
const peak = (page: Page) => page.evaluate(() => (window as unknown as { __peak: number }).__peak);

test("the slot machine's cues are audible and unclipped", async ({ page }) => {
  await tapOutput(page);
  await page.goto("/?role=killer");
  await expect(page.locator("[data-perk-card]")).toHaveCount(4);
  await chooseSlots(page);

  /* The settle before arming is load-bearing. The reverb tail runs 1.1s, so
   * measuring one cue immediately after another measures the previous one
   * still ringing — which is how an assertion about a cue I had just DELETED
   * passed at 0.0445. */
  const measure = async (act: () => Promise<void>) => {
    await page.waitForTimeout(1400);
    await arm(page);
    await act();
    await page.waitForTimeout(800);
    return peak(page);
  };

  const roll = await measure(async () => {
    await page.getByRole("button", { name: "Сгенерировать новый билд" }).click();
  });
  const deal = await measure(async () => {
    await page.keyboard.press("2");
  });

  console.log(`roll=${roll.toFixed(4)} deal=${deal.toFixed(4)}`);
  for (const [name, value] of [["roll", roll], ["deal", deal]] as const) {
    expect(value, `the ${name} cue is silent`).toBeGreaterThan(0.004);
    // Above 1.0 the destination hard-clips, which is audible as a buzz.
    expect(value, `the ${name} cue is clipping`).toBeLessThan(1);
  }
});

test("outside the slot machine the site is completely silent", async ({ page, context }) => {
  /* The actual requirement: sound is the slot machine's, not the site's.
   * Checked at the strongest point available — no audio graph is ever built —
   * so it cannot be satisfied by cues that merely happen to be quiet. */
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.addInitScript(() => {
    const w = window as unknown as { __ctxCount: number; AudioContext: typeof AudioContext };
    w.__ctxCount = 0;
    const Real = w.AudioContext;
    w.AudioContext = class extends Real {
      constructor(...args: ConstructorParameters<typeof AudioContext>) {
        super(...args);
        w.__ctxCount++;
      }
    } as unknown as typeof AudioContext;
  });
  await page.goto("/?role=killer");
  await expect(page.locator("[data-perk-card]")).toHaveCount(4);

  // Everything that used to make a noise: rolling, rerolling one slot,
  // copying, pinning.
  await page.getByRole("button", { name: "Сгенерировать новый билд" }).click();
  await page.keyboard.press("2");
  await page.getByRole("button", { name: /^Копировать$/ }).first().click();
  await page.waitForTimeout(700);

  expect(
    await page.evaluate(() => (window as never as { __ctxCount: number }).__ctxCount),
    "the classic presentation built an audio graph",
  ).toBe(0);
});

test("muting is real silence, not merely quiet", async ({ page }) => {
  await tapOutput(page);
  await page.goto("/?role=killer");
  await expect(page.locator("[data-perk-card]")).toHaveCount(4);
  await chooseSlots(page);
  // Play something first so the graph exists and the tap is attached.
  await page.getByRole("button", { name: "Сгенерировать новый билд" }).click();
  await page.waitForTimeout(600);

  await page.getByTestId("sound-control").click();
  await page.getByTestId("sound-mute").click();
  await expect(page.getByTestId("sound-control")).toHaveAttribute("data-muted", "1");
  await page.keyboard.press("Escape");

  /* Let the tap drain before measuring silence.
   *
   * The analyser holds ~0.7s of audio and the reverb tail runs 1.1s, so
   * arming immediately after muting measures the cue from BEFORE the mute
   * and reports the feature broken when it is working. */
  await page.waitForTimeout(2200);
  await arm(page);
  await page.getByRole("button", { name: "Сгенерировать новый билд" }).click();
  await page.waitForTimeout(900);
  expect(await peak(page), "a muted site still emitted signal").toBeLessThan(0.0005);
});
