"use client";

import { useEffect, useRef } from "react";
import { withBasePath } from "@/lib/asset-path";
import { ROLE_COLOR } from "@/lib/role-color";
import type { Perk, PerkRole } from "@/lib/types";

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
}: {
  pool: Perk[];
  perks: Perk[];
  role: PerkRole;
  language: "en" | "ru";
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Read live by the draw loop; written in an effect, never during render.
  const roleRef = useRef(role);
  useEffect(() => {
    roleRef.current = role;
  }, [role]);
  const state = useRef({ reels: [] as Reel[], W: 0, H: 0, flash: 0 });

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

    s.reels = perks.map((perk, i) => {
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
      return {
        strip,
        names,
        slugs,
        target: 0,
        offset: 0,
        speed: 26 + i * 2,
        // Staggered stops: the last reel is what makes it feel like a result
        // rather than four things ending at once.
        stopAt: now + (reduced ? 0.01 : 0.55 + i * 0.32),
        settled: false,
      };
    });
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

      ctx!.clearRect(0, 0, s.W, s.H);
      const n = s.reels.length;
      if (n === 0) {
        raf = requestAnimationFrame(frame);
        return;
      }

      const gap = Math.max(8, s.W * 0.018);
      const rw = Math.min(150, (s.W - gap * (n + 1)) / n);
      // The name gets its own band under the well. Drawn inside it, the label
      // printed straight over whichever symbol happened to be on the bottom
      // row.
      const labelH = Math.max(18, rw * 0.26);
      const rh = Math.min(s.H * 0.74 - labelH, rw * 1.5);
      const top = (s.H - (rh + labelH)) / 2;
      const cell = rh / 3; // three symbols visible per reel
      const startX = (s.W - (n * rw + (n - 1) * gap)) / 2;

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
        const well = ctx!.createLinearGradient(0, top, 0, top + rh);
        well.addColorStop(0, "rgba(8,10,14,0.98)");
        well.addColorStop(0.5, "rgba(20,23,30,0.95)");
        well.addColorStop(1, "rgba(8,10,14,0.98)");
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
          ctx!.drawImage(img, x + rw / 2 - size / 2, y - size / 2, size, size);
        }
        ctx!.restore();

        // Frame + pay line
        ctx!.strokeStyle = reel.settled ? `${accent}88` : "rgba(232,228,220,0.14)";
        ctx!.lineWidth = 1;
        roundRect(ctx!, x, top, rw, rh, 14);
        ctx!.stroke();

        if (reel.settled) {
          ctx!.fillStyle = "#e8e4dc";
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
      grad.addColorStop(0, "rgba(232,228,220,0)");
      grad.addColorStop(0.5, `${accent}${Math.round(lineAlpha * 255).toString(16).padStart(2, "0")}`);
      grad.addColorStop(1, "rgba(232,228,220,0)");
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
      className="relative aspect-[16/7] w-full max-w-4xl overflow-hidden rounded-2xl border border-border bg-[#0a0c10]"
    >
      <canvas ref={canvasRef} className="absolute inset-0 size-full" aria-hidden />
      <ul className="sr-only">
        {perks.map((p) => (
          <li key={p.slug}>{p.name[language]}</li>
        ))}
      </ul>
    </div>
  );
}
