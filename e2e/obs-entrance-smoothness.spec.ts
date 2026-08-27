import { test, expect, type Page } from "@playwright/test";
import perks from "../data/perks.json";

/* "Smooth, not abrupt" as something a test can actually check.
 *
 * Two things make an entrance read as abrupt, and both are measurable:
 *
 *   Overshoot — a spring lands by going PAST its resting position and
 *   springing back. That reversal is a small hard stop, and it is what the
 *   existing `drop` does on purpose ("falls from above and bounces"). `deal`
 *   and `spin` must not.
 *
 *   No deceleration — motion that covers the same distance every frame and
 *   then simply stops. An ease-out slows into its final position; the per-
 *   frame distance late in the animation has to be a fraction of what it was
 *   early on.
 *
 * Sampled frame by frame inside the page rather than by reading a paused DOM,
 * which tells you nothing about motion.
 */

const STORAGE_KEY = "dbd-randomizer:obs-last-state";

const build = () => ({
  role: "killer",
  language: "ru",
  mode: "perks",
  character: null,
  perks: (perks as Array<{ slug: string; role: string; name: { en: string; ru: string }; icon: string }>)
    .filter((p) => p.role === "killer")
    .slice(0, 4)
    .map((p) => ({ slug: p.slug, name: p.name, icon: p.icon })),
});

/** translateY and scale magnitude for the first card, once per frame. */
async function sampleEntrance(page: Page, entrance: string) {
  await page.addInitScript(
    ([key, state]) => localStorage.setItem(key as string, JSON.stringify(state)),
    [STORAGE_KEY, build()] as const,
  );
  await page.goto(`/?obs=1&anim=${entrance}`);
  return page.evaluate(
    () =>
      new Promise<Array<{ t: number; y: number; scale: number }>>((resolve) => {
        const out: Array<{ t: number; y: number; scale: number }> = [];
        const t0 = performance.now();
        const tick = () => {
          // data-obs-piece is the motion.div itself — the element the
          // entrance transform is applied to. Its ancestors carry none of it.
          const el = document.querySelector<HTMLElement>("[data-obs-piece]");
          if (el) {
            const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
            out.push({
              t: performance.now() - t0,
              y: m.f,
              scale: Math.hypot(m.a, m.b),
            });
          }
          if (performance.now() - t0 < 1600) requestAnimationFrame(tick);
          else resolve(out);
        };
        requestAnimationFrame(tick);
      }),
  );
}

/** How far the element moved between consecutive samples. */
const steps = (s: Array<{ y: number }>) =>
  s.slice(1).map((p, i) => Math.abs(p.y - s[i].y));

for (const entrance of ["deal", "spin"] as const) {
  test(`${entrance} actually animates rather than appearing`, async ({ page }) => {
    const samples = await sampleEntrance(page, entrance);
    expect(samples.length, "no frames sampled at all").toBeGreaterThan(20);
    const moved = steps(samples).filter((d) => d > 0.1).length;
    expect(moved, `${entrance} never moved — it just appeared`).toBeGreaterThan(5);
  });

  test(`${entrance} never overshoots its resting place`, async ({ page }) => {
    /* Both start ABOVE their final position (negative translateY) and ease
       down to 0. Passing 0 means it went below and has to come back — the
       bounce that reads as a hard stop. */
    const samples = await sampleEntrance(page, entrance);
    const worst = Math.max(...samples.map((s) => s.y));
    expect(worst, `${entrance} overshot to y=${worst.toFixed(2)}`).toBeLessThan(1.5);

    const biggest = Math.max(...samples.map((s) => s.scale));
    expect(biggest, `${entrance} scaled past 1 to ${biggest.toFixed(3)}`).toBeLessThan(1.02);
  });

  test(`${entrance} decelerates into place`, async ({ page }) => {
    const samples = await sampleEntrance(page, entrance);
    const moving = samples.filter((s) => Math.abs(s.y) > 0.5);
    expect(moving.length, "not enough motion to measure").toBeGreaterThan(8);

    const d = steps(moving);
    const early = d.slice(0, Math.floor(d.length / 3));
    const late = d.slice(-Math.floor(d.length / 3));
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);

    expect(
      avg(late),
      `${entrance} does not slow down: ${avg(early).toFixed(2)}px/frame early vs ${avg(late).toFixed(2)} late`,
    ).toBeLessThan(avg(early) * 0.6);
  });
}

test("the bouncing entrance still bounces, so the check above discriminates", async ({ page }) => {
  /* `drop` is documented as "falls from above and bounces" and uses a spring.
     If it passed the no-overshoot test, that test would be measuring nothing.
     This is the control. */
  const samples = await sampleEntrance(page, "drop");
  const worst = Math.max(...samples.map((s) => s.y));
  expect(worst, "drop no longer overshoots — the smoothness check may be vacuous").toBeGreaterThan(1.5);
});
