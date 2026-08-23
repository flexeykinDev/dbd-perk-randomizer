import { test, expect, type Page } from "@playwright/test";

/* Can the text be read, in both themes?
 *
 * Light mode was covered only by unit tests over the theme tokens, which
 * cannot catch a colour that resolves to the wrong side of the surface it
 * ends up on — and the light theme has already regressed visibly once.
 *
 * This walks every visible run of text, finds the surface actually behind it,
 * and measures the WCAG contrast ratio. Two things keep it honest rather than
 * decorative: elements sitting over a gradient or an image are counted and
 * reported as skipped instead of quietly passing, and the test fails if the
 * number it managed to check is implausibly small — a selector that stops
 * matching would otherwise turn this into a test of nothing.
 */

interface Sample {
  ratio: number;
  text: string;
  size: number;
  color: string;
  background: string;
  where: string;
}

interface Audit {
  checked: number;
  skipped: number;
  failures: Sample[];
}

async function auditContrast(page: Page): Promise<Audit> {
  return page.evaluate(() => {
    /* Colours are resolved by painting them, not by parsing them.
     *
     * A regex over rgb()/rgba() is the obvious approach and it is wrong here:
     * Tailwind v4 emits lab() and oklch(), and getComputedStyle hands those
     * back verbatim. The regex returned null for them, the resolver treated
     * "unparseable" as "transparent", and a NEW badge that is black on
     * sky-500 was reported as black on the card surface at 1.31:1 -- a
     * confident failure for text that is perfectly readable.
     *
     * Filling a 1x1 canvas and reading the pixel back delegates the whole
     * question to the browser, so every colour syntax it supports now and
     * later resolves correctly. */
    const probe = document.createElement("canvas");
    probe.width = probe.height = 1;
    const pctx = probe.getContext("2d", { willReadFrequently: true })!;
    const cache = new Map<string, [number, number, number, number] | null>();

    const parse = (value: string): [number, number, number, number] | null => {
      if (cache.has(value)) return cache.get(value)!;
      let out: [number, number, number, number] | null = null;
      pctx.clearRect(0, 0, 1, 1);
      pctx.fillStyle = "#000";
      pctx.fillStyle = value;
      // An invalid colour leaves fillStyle at the previous value, which is
      // how a typo is told apart from a real black.
      if (!(pctx.fillStyle === "#000000" && value.trim() !== "#000000")) {
        pctx.fillRect(0, 0, 1, 1);
        const [r, g, b, a] = pctx.getImageData(0, 0, 1, 1).data;
        out = [r, g, b, a / 255];
      }
      if (out && out[3] === 0) out = [out[0], out[1], out[2], 0];
      cache.set(value, out);
      return out;
    };

    const channel = (c: number) => {
      const v = c / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    const luminance = ([r, g, b]: number[]) =>
      0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    const contrast = (a: number[], b: number[]) => {
      const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    };
    /** Text colour composited over what is behind it. */
    const over = (fg: [number, number, number, number], bg: number[]) =>
      [0, 1, 2].map((i) => fg[i] * fg[3] + bg[i] * (1 - fg[3]));

    const failures: Sample[] = [];
    let checked = 0;
    let skipped = 0;

    const all = Array.from(document.querySelectorAll<HTMLElement>("body *"));
    for (const el of all) {
      // Only elements that render their own text, not containers of it.
      const own = Array.from(el.childNodes).some(
        (n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim().length > 1,
      );
      if (!own) continue;

      const rect = el.getBoundingClientRect();
      if (rect.width < 4 || rect.height < 4) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.opacity === "0") continue;

      const fg = parse(cs.color);
      if (!fg) continue;

      /* What is actually behind this text, resolved down the paint stack
       * rather than up the DOM tree.
       *
       * Walking ancestors was wrong in a way that produced a confident false
       * failure: the trailer's caption is positioned over a thumbnail <img>,
       * which is a sibling and not an ancestor background, so the walk sailed
       * past it and compared white text against the page surface -- reporting
       * 1.06:1 for text that is in fact white on a dark still. elementsFromPoint
       * sees what the compositor sees. */
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const onScreen = cx >= 0 && cy >= 0 && cx < innerWidth && cy < innerHeight;

      /* Two ways of finding the surface, because neither is enough alone.
       *
       * Hit-testing is the accurate one -- it sees the stack the compositor
       * sees, including a thumbnail <img> that a caption is positioned over,
       * which is a sibling rather than an ancestor background. Walking
       * ancestors missed exactly that and reported white-on-dark caption text
       * as 1.06:1 against the page surface.
       *
       * But elementsFromPoint only answers inside the viewport, and most of
       * this page is below the fold: using it alone dropped the sample from
       * 39 elements to 15, which is how a contrast test quietly stops being
       * one. So off-screen text falls back to the ancestor walk, and anything
       * either method cannot resolve is counted as skipped. */
      let bg: number[] | null = null;
      let painted = false;

      const layerOf = (node: HTMLElement): "paint" | [number, number, number, number] | null => {
        if (["IMG", "VIDEO", "CANVAS", "SVG", "IFRAME"].includes(node.tagName)) return "paint";
        const st = getComputedStyle(node);
        if (st.backgroundImage !== "none") return "paint";
        const c = parse(st.backgroundColor);
        return c && c[3] > 0 ? c : null;
      };

      const stack = onScreen ? (document.elementsFromPoint(cx, cy) as HTMLElement[]) : [];
      const from = stack.indexOf(el);
      const chain =
        from >= 0
          ? stack.slice(from)
          : (() => {
              const up: HTMLElement[] = [];
              for (let n: HTMLElement | null = el; n; n = n.parentElement) up.push(n);
              return up;
            })();

      /* Translucent layers are composited, not skipped.
       *
       * Taking the first layer with alpha above a threshold and ignoring what
       * sits on top of it gets semi-transparent chips exactly backwards: a
       * NEW badge is white text on bg-black/60, and skipping that 60% black
       * compared white against the white card underneath -- 1:1, reported as
       * unreadable, when in practice it composites to grey at about 5.7:1. */
      const layers: [number, number, number, number][] = [];
      for (const under of chain) {
        const layer = layerOf(under);
        if (layer === "paint") {
          painted = true;
          break;
        }
        if (!layer) continue;
        layers.push(layer);
        if (layer[3] >= 0.999) break;
      }

      if (!painted && layers.length > 0 && layers[layers.length - 1][3] >= 0.999) {
        // Fold from the deepest opaque layer up towards the viewer.
        let acc = [layers[layers.length - 1][0], layers[layers.length - 1][1], layers[layers.length - 1][2]];
        for (let i = layers.length - 2; i >= 0; i--) {
          const [r, g, b, a] = layers[i];
          acc = [r * a + acc[0] * (1 - a), g * a + acc[1] * (1 - a), b * a + acc[2] * (1 - a)];
        }
        bg = acc;
      }

      if (painted || !bg) {
        skipped++;
        continue;
      }

      checked++;
      const size = parseFloat(cs.fontSize);
      const weight = Number(cs.fontWeight) || 400;
      const isLarge = size >= 24 || (size >= 18.66 && weight >= 700);
      const ratio = contrast(over(fg, bg), bg);
      const limit = isLarge ? 3 : 4.5;
      if (ratio < limit) {
        failures.push({
          ratio: Math.round(ratio * 100) / 100,
          text: (el.textContent ?? "").trim().slice(0, 40),
          size,
          color: cs.color,
          background: `rgb(${bg.map(Math.round).join(", ")})`,
          where: `${el.tagName.toLowerCase()}.${el.className.toString().split(" ")[0] ?? ""}`,
        });
      }
    }
    failures.sort((a, b) => a.ratio - b.ratio);
    return { checked, skipped, failures };
  });
}

const VIEWS = [
  { name: "perks", url: "/?role=killer" },
  { name: "loadout", url: "/?role=survivor&mode=all" },
];

for (const theme of ["light", "dark"] as const) {
  for (const view of VIEWS) {
    test(`${theme}: text on ${view.name} meets WCAG AA`, async ({ page }) => {
      await page.addInitScript(
        (t) => localStorage.setItem("dbd-randomizer:theme", t),
        theme,
      );
      await page.goto(view.url);
      await expect(page.locator("[data-perk-card]")).toHaveCount(4);
      // Dark is the document default and does not always stamp the
      // attribute; light always opts in explicitly.
      if (theme === "light") {
        await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
      } else {
        await expect(page.locator("html")).not.toHaveAttribute("data-theme", "light");
      }

      const audit = await auditContrast(page);
      console.log(
        `[${theme}/${view.name}] checked ${audit.checked}, skipped ${audit.skipped} over gradients, ${audit.failures.length} below AA`,
      );
      for (const f of audit.failures.slice(0, 8)) {
        console.log(
          `   ${f.ratio}:1  ${f.size}px  ${f.color} on ${f.background}  "${f.text}"  (${f.where})`,
        );
      }

      // A selector that stopped matching would make everything above vacuous.
      expect(audit.checked, "almost nothing was actually measured").toBeGreaterThan(15);
      expect(
        audit.failures.map((f) => `${f.ratio}:1 "${f.text}" (${f.where})`),
        "text below WCAG AA contrast",
      ).toEqual([]);
    });
  }
}
