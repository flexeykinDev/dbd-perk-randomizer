"use client";

import { useEffect, useRef, useState } from "react";
import { withBasePath } from "@/lib/asset-path";
import { ROLE_COLOR } from "@/lib/role-color";
import { useThemeTokens, type ThemeTokens } from "@/lib/theme-tokens";
import type { Perk, PerkRole } from "@/lib/types";
import { PerkDetailModal } from "./perk-grid";
import { StageControls } from "./stage-controls";

/* "Slots": one reel per perk slot, spun up together and stopped left to
 * right, landing on the build the board rolled.
 *
 * Like the Ritual stage this rolls nothing — the reels are guaranteed to stop
 * on `perks` because the stopping symbol is written into the strip before the
 * spin starts. A reel that landed wherever it happened to land would be a
 * second randomiser, and would disagree with the build the rest of the page
 * shows.
 *
 * Canvas rather than DOM: a reel is a strip of images sliding under a mask at
 * high speed, and doing that with transformed elements means the browser
 * compositing dozens of nodes per frame for something that is one drawImage
 * per visible symbol.
 */

const STRIP = 14; // symbols per reel — enough that the loop never shows a seam

/** Where each reel well sits. Shared with the DOM interaction layer for the
 *  same reason as ritualCardRect. */
export function reelRect(W: number, H: number, i: number, n: number) {
  const gap = Math.max(8, W * 0.018);
  const rw = Math.min(150, (W - gap * (n + 1)) / n);
  const labelH = Math.max(18, rw * 0.26);
  const rh = Math.min(H * 0.6 - labelH, rw * 1.5);
  const top = (H - (rh + labelH)) / 2;
  const startX = (W - (n * rw + (n - 1) * gap)) / 2;
  return { x: startX + i * (rw + gap), y: top, w: rw, h: rh, labelH, gap };
}

interface Reel {
  strip: HTMLImageElement[];
  names: string[];
  /** Slug of every symbol on the strip, parallel to `strip`. Exists so the
   *  stage can publish what it is really going to land on — see the
   *  data-shown attribute below. */
  slugs: string[];
  /** Index within `strip` the reel must come to rest on. */
  target: number;
  offset: number;
  speed: number;
  stopAt: number;
  settled: boolean;
}

export function SlotsStage({
  pool,
  perks,
  role,
  language,
  pinnedSlots,
  onCopy,
  onTogglePin,
  onRerollSlot,
}: {
  pool: Perk[];
  perks: Perk[];
  role: PerkRole;
  language: "en" | "ru";
  /** Slot index -> pinned perk slug, exactly as PerkGrid receives it. */
  pinnedSlots?: Record<number, string>;
  onCopy: (perk: Perk) => void;
  onTogglePin?: (slot: number, slug: string) => void;
  onRerollSlot?: (slot: number) => void;
}) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [detail, setDetail] = useState<Perk | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Read live by the draw loop; written in an effect, never during render.
  const roleRef = useRef(role);
  const theme = useThemeTokens();
  const themeRef = useRef<ThemeTokens>(theme);
  useEffect(() => {
    roleRef.current = role;
    themeRef.current = theme;
  }, [role, theme]);
  const state = useRef({
    reels: [] as Reel[],
    W: 0,
    H: 0,
    flash: 0,
    /** Slugs the reels were last built for, to tell a single-slot reroll
     *  apart from a whole new build. */
    shown: [] as string[],
  });

  const perkKey = perks.map((p) => p.slug).join(",");
  const poolKey = pool.length;

  useEffect(() => {
    const s = state.current;
    if (perks.length === 0) {
      s.reels = [];
      return;
    }
    const now = performance.now() / 1000;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const filler = pool.length > 0 ? pool : perks;

    /* Which slots actually changed. Pressing 1-4 rerolls ONE perk, and
       replaying the full four-reel spin for it overstated what happened —
       the machine looked like it had done a whole new pull. Only the reels
       whose perk changed are respun; the rest keep the offset they settled
       on, so they read as held. */
    const changed = perks.map((p, i) => s.shown[i] !== p.slug);
    const everything = s.reels.length !== perks.length || changed.every(Boolean);
    let order = 0;

    s.reels = perks.map((perk, i) => {
      const previous = s.reels[i];
      if (!changed[i] && previous) return previous;
      const names: string[] = [];
      const slugs: string[] = [];
      const strip: HTMLImageElement[] = [];
      for (let k = 0; k < STRIP; k++) {
        // The reel is padded with real perks from the same pool, so a spin
        // shows plausible symbols rather than repeats of the answer.
        const p = k === 0 ? perk : filler[(i * 7 + k * 3) % filler.length];
        const img = new Image();
        img.src = withBasePath(p.icon);
        strip.push(img);
        names.push(p.name[language]);
        slugs.push(p.slug);
      }
      // A full pull staggers left to right — the last reel landing is what
      // makes it a result. A single respun reel has nothing to stagger
      // against, so it just goes.
      const delay = reduced ? 0.01 : everything ? 0.55 + order * 0.32 : 0.42;
      order++;
      return {
        strip,
        names,
        slugs,
        target: 0,
        offset: previous && !everything ? previous.offset : 0,
        speed: 26 + i * 2,
        stopAt: now + delay,
        settled: false,
      };
    });
    s.shown = perks.map((p) => p.slug);
    s.flash = 0;
    /* What the reels will actually stop on, read back off the strips the
       canvas draws from rather than off the props. A stage that quietly
       showed different perks than the board rolled would be invisible to any
       assertion made against the props — this is the seam that makes it
       testable. See e2e/presentation.spec.ts. */
    if (hostRef.current) {
      hostRef.current.dataset.shown = s.reels
        .map((r) => r.slugs[r.target])
        .join(",");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perkKey, poolKey, language]);

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const s = state.current;

    let dpr = 1;
    const measure = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      s.W = host.clientWidth;
      s.H = host.clientHeight;
      canvas.width = Math.max(1, Math.round(s.W * dpr));
      canvas.height = Math.max(1, Math.round(s.H * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // Mirrored into React state for the DOM control layer.
      setSize({ w: s.W, h: s.H });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(host);

    /* Stop drawing when there is nobody to see it. A canvas loop left running
       in a background tab or scrolled out of view costs a frame's work sixty
       times a second for no picture at all — and on a laptop that is measured
       in battery. Both conditions matter: `document.hidden` covers the tab,
       the observer covers a stage scrolled past. */
    let visible = true;
    let onScreen = true;
    const io = new IntersectionObserver(
      ([entry]) => {
        onScreen = entry.isIntersecting;
        pump();
      },
      { threshold: 0 },
    );
    io.observe(host);
    const onVisibility = () => {
      visible = !document.hidden;
      pump();
    };
    document.addEventListener("visibilitychange", onVisibility);

    function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
      c.beginPath();
      c.moveTo(x + r, y);
      c.arcTo(x + w, y, x + w, y + h, r);
      c.arcTo(x + w, y + h, x, y + h, r);
      c.arcTo(x, y + h, x, y, r);
      c.arcTo(x, y, x + w, y, r);
      c.closePath();
    }

    let raf = 0;
    let last = performance.now() / 1000;
    function pump() {
      const shouldRun = visible && onScreen;
      if (shouldRun && !raf) {
        // Reset the clock: a paused loop must not resume thinking a minute
        // of animation happened while it was stopped.
        last = performance.now() / 1000;
        raf = requestAnimationFrame(frame);
      } else if (!shouldRun && raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    }
    function frame(now: number) {
      const time = now / 1000;
      const dt = Math.min(0.05, time - last);
      last = time;
      const accent = ROLE_COLOR[roleRef.current].solid;
      const th = themeRef.current;

      ctx!.clearRect(0, 0, s.W, s.H);
      const n = s.reels.length;
      if (n === 0) {
        raf = requestAnimationFrame(frame);
        return;
      }

      // The name gets its own band under the well. Drawn inside it, the label
      // printed straight over whichever symbol happened to be on the bottom
      // row.
      const base = reelRect(s.W, s.H, 0, n);
      const { w: rw, h: rh, labelH, gap } = base;
      const top = base.y;
      const cell = rh / 3; // three symbols visible per reel
      const startX = base.x;

      let allSettled = true;
      for (let i = 0; i < n; i++) {
        const reel = s.reels[i];
        if (!reel.settled) {
          allSettled = false;
          if (time >= reel.stopAt) {
            // Ease into the target rather than snapping: the deceleration is
            // the part that reads as a slot machine.
            const distance = (reel.target - reel.offset) % STRIP;
            const wrapped = distance < 0 ? distance + STRIP : distance;
            reel.offset += Math.max(wrapped, 0.0001) * Math.min(1, dt * 6);
            if (wrapped < 0.012) {
              reel.offset = reel.target;
              reel.settled = true;
              s.flash = 1;
            }
          } else {
            reel.offset = (reel.offset + reel.speed * dt) % STRIP;
          }
        }

        const x = startX + i * (rw + gap);
        // Reel well
        ctx!.save();
        // A reel well reads as depth: darker at the lips than in the middle
        // on a dark page, and the reverse on a light one, so the shading is
        // shadow either way rather than a black tube dropped into white.
        const well = ctx!.createLinearGradient(0, top, 0, top + rh);
        well.addColorStop(0, th.background);
        well.addColorStop(0.5, th.surface);
        well.addColorStop(1, th.background);
        ctx!.fillStyle = well;
        roundRect(ctx!, x, top, rw, rh, 14);
        ctx!.fill();
        ctx!.clip();

        const frac = reel.offset - Math.floor(reel.offset);
        for (let row = -1; row <= 2; row++) {
          const idx = (Math.floor(reel.offset) + row + STRIP * 2) % STRIP;
          const img = reel.strip[idx];
          const y = top + (row + 1 - frac) * cell + cell / 2;
          if (!img?.complete || !img.naturalWidth) continue;
          const size = Math.min(cell * 0.78, rw * 0.66);
          // Symbols away from the pay line sit back in the well.
          const centreness = 1 - Math.min(1, Math.abs(y - (top + rh / 2)) / (rh / 2));
          ctx!.globalAlpha = 0.14 + 0.86 * Math.pow(centreness, 1.6);
          // Same inversion the page applies to perk art on the light theme
          // (.icon-art); a canvas gets no cascade.
          if (th.isLight) ctx!.filter = "invert(0.92)";
          ctx!.drawImage(img, x + rw / 2 - size / 2, y - size / 2, size, size);
          ctx!.filter = "none";
        }
        ctx!.restore();

        // Frame + pay line
        ctx!.strokeStyle = reel.settled ? `${accent}aa` : th.border;
        ctx!.lineWidth = 1;
        roundRect(ctx!, x, top, rw, rh, 14);
        ctx!.stroke();

        if (reel.settled) {
          ctx!.fillStyle = th.foreground;
          ctx!.font = `500 ${Math.max(9, rw * 0.093)}px Oswald, "Arial Narrow", sans-serif`;
          ctx!.textAlign = "center";
          let line = reel.names[reel.target].toUpperCase();
          const full = line;
          while (ctx!.measureText(line).width > rw * 0.92 && line.length > 4) line = line.slice(0, -1);
          ctx!.fillText(line === full ? full : `${line}…`, x + rw / 2, top + rh + labelH * 0.68);
        }
      }

      // Pay line across the reels, brightening as the last one lands.
      if (s.flash > 0) s.flash = Math.max(0, s.flash - dt * 1.6);
      const lineAlpha = 0.1 + (allSettled ? 0.28 : 0.06) + s.flash * 0.3;
      const grad = ctx!.createLinearGradient(startX, 0, startX + n * rw + (n - 1) * gap, 0);
      grad.addColorStop(0, "rgba(127,127,127,0)");
      grad.addColorStop(0.5, `${accent}${Math.round(lineAlpha * 255).toString(16).padStart(2, "0")}`);
      grad.addColorStop(1, "rgba(127,127,127,0)");
      ctx!.fillStyle = grad;
      ctx!.fillRect(startX - gap, s.H / 2 - 0.5, n * rw + (n - 1) * gap + gap * 2, 1);

      raf = visible && onScreen ? requestAnimationFrame(frame) : 0;
    }
    pump();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return (
    <div
      ref={hostRef}
      data-testid="slots-stage"
      className="relative aspect-[16/7] w-full max-w-4xl overflow-hidden rounded-2xl border border-border bg-background"
    >
      <canvas ref={canvasRef} className="absolute inset-0 size-full" aria-hidden />
      <ul className="sr-only">
        {perks.map((p) => (
          <li key={p.slug}>{p.name[language]}</li>
        ))}
      </ul>
      <StageControls
        perks={perks}
        language={language}
        rects={perks.map((_, i) => {
          const r = reelRect(size.w, size.h, i, perks.length);
          // The well plus its name band: the controls belong under the label,
          // not on top of it.
          return { x: r.x, y: r.y, w: r.w, h: r.h + r.labelH };
        })}
        pinnedSlots={pinnedSlots}
        onOpenDetail={setDetail}
        onCopy={onCopy}
        onTogglePin={onTogglePin}
        onRerollSlot={onRerollSlot}
      />
      <PerkDetailModal
        perk={detail}
        language={language}
        onCopy={onCopy}
        onClose={() => setDetail(null)}
      />
    </div>
  );
}
