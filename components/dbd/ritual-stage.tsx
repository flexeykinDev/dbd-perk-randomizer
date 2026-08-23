"use client";

import { useEffect, useRef, useState } from "react";
import { withBasePath } from "@/lib/asset-path";
import { ROLE_COLOR } from "@/lib/role-color";
import { useThemeTokens, type ThemeTokens } from "@/lib/theme-tokens";
import type { Perk, PerkRole } from "@/lib/types";
import { PerkDetailModal } from "./perk-grid";
import { StageControls } from "./stage-controls";

/* "Ritual": the pool swirls as a funnel of perk icons, and a roll deals the
 * build that came out into a hand of cards.
 *
 * It rolls nothing. `perks` is whatever the board produced, and a change of
 * that list is the only thing that triggers a deal — see lib/use-presentation.
 *
 * The fog is a fragment shader rather than layered CSS gradients because the
 * motion is the idea: it twists per-pixel around the eye, tightening as it
 * goes in, which a rotating bitmap cannot do. Where WebGL is unavailable the
 * canvas stays the ground colour and the icons carry the scene on their own —
 * checked, not assumed, because a failed context here must not blank the
 * board. */

const TAU = Math.PI * 2;
const ICON_PX = 112;

/** The game's own role emblems, scraped by scripts/scrape-role-icons.ts. */
const ROLE_EMBLEM: Record<PerkRole, string> = {
  survivor: "/roles/survivor.png",
  killer: "/roles/killer.png",
};
const MAX_MOTES = 22;

const MOOD: Record<PerkRole, [number, number, number]> = {
  killer: [0.886, 0.408, 0.376],
  survivor: [0.345, 0.698, 0.886],
};

const VERT = "attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }";

const FRAG = `
precision highp float;
uniform vec2 uRes; uniform float uTime; uniform float uSpin; uniform vec3 uTint;
uniform vec3 uGround; uniform vec3 uHaze; uniform float uTintAmt;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1,0)), u.x),
             mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), u.x), u.y);
}
float fbm(vec2 p){
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++){ v += a * noise(p); p *= 2.02; a *= 0.5; }
  return v;
}
void main(){
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  float r = length(uv);
  float ang = atan(uv.y, uv.x);
  float twist = ang + uSpin * (0.55 / (r + 0.22)) + uTime * 0.05;
  vec2 warp = vec2(cos(twist), sin(twist)) * r;
  float d = fbm(warp * 2.6 + vec2(uTime * 0.06, -uTime * 0.04));
  d = fbm(warp * 3.4 + d * 1.6 + vec2(0.0, uTime * 0.03));
  float funnel = smoothstep(0.02, 0.66, r) * (1.0 - smoothstep(0.9, 1.6, r));
  float dens = pow(d, 1.45) * funnel;
  // Ground and haze come from the page's own tokens, so the fog is light on
  // the light theme and dark on the dark one instead of always near-black.
  vec3 col = mix(uGround, uHaze, clamp(dens * 1.5, 0.0, 1.0));
  col += uTint * uTintAmt * dens * (0.55 + 0.45 * uSpin);
  col += uTint * uTintAmt * 0.5 * smoothstep(0.4, 0.0, r) * (0.4 + 0.6 * uSpin);
  col = mix(col, uGround, 0.4 * smoothstep(0.62, 1.5, r));
  col += (hash(gl_FragCoord.xy + fract(uTime) * 91.0) - 0.5) * 0.018;
  gl_FragColor = vec4(col, 1.0);
}`;

/** Where the dealt cards land. Exported because the interaction layer sits
 *  in the DOM on top of the canvas and has to line up with what is painted;
 *  two copies of this arithmetic would drift the first time either changed. */
export function ritualCardRect(W: number, H: number, i: number, n: number) {
  // Cards were sized for a stage that turned out to sit in a lot of empty
  // page in perks-only mode; the same four cards read fine next to the
  // loadout row and small on their own.
  const cw = Math.min(170, Math.max(72, W / (n + 2.1)));
  const ch = cw * 1.4143 * 0.99;
  const gap = cw * 0.3;
  const total = n * cw + (n - 1) * gap;
  const cx = W / 2 - total / 2 + i * (cw + gap) + cw / 2;
  return { x: cx - cw / 2, y: H * 0.52 - ch / 2, w: cw, h: ch };
}

/** Where a mote sits in the funnel at a given moment.
 *
 *  Module scope on purpose: the draw loop and the single-slot swap both need
 *  it, and a second copy of this arithmetic would drift the first time either
 *  changed — the swap would then fly a card in from a point the vortex is not
 *  actually at. */
function funnelPoint(
  m: { seed: number; lane: number; bob: number },
  W: number,
  H: number,
  time: number,
  spin: number,
  dim: number,
) {
  const radius = Math.min(W * 0.46, H * 0.95) * (0.34 + 0.5 * m.seed * m.seed);
  // Roughly half the old rate. At the previous speed the icons crossed the
  // frame fast enough to strobe rather than drift, which read as "not
  // smooth" — the frames were fine, the motion was just too quick for the
  // eye to track anything.
  const speed = (0.2 + 0.24 * (1 - m.seed)) * (0.4 + 0.6 * spin);
  const ang = m.lane + time * speed;
  const depth = Math.sin(ang) * 0.5 + 0.5;
  return {
    x: W / 2 + Math.cos(ang) * radius * (0.92 + 0.16 * depth),
    y: H * 0.5 - (m.seed - 0.5) * H * 0.62 + Math.sin(time * 0.7 + m.bob) * 6,
    s: (0.3 + 0.34 * depth) * (Math.min(W, H) / 620 + 0.4),
    a: (0.28 + 0.72 * (depth * depth * (3 - 2 * depth))) * dim,
    z: Math.sin(ang),
  };
}

interface Mote {
  perk: Perk;
  img: HTMLImageElement;
  seed: number;
  lane: number;
  bob: number;
  from: { x: number; y: number; s: number; a: number } | null;
  to: { x: number; y: number; s: number; a: number } | null;
  t0: number;
  dur: number;
  card: boolean;
}

export function RitualStage({
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
  const fogRef = useRef<HTMLCanvasElement>(null);
  const spriteRef = useRef<HTMLCanvasElement>(null);
  // The draw loop is mounted once and reads these live. Assigned in an
  // effect rather than during render: a ref written while rendering is not
  // safe under concurrent rendering, and the compiler rejects it.
  const roleRef = useRef(role);
  const langRef = useRef(language);
  const theme = useThemeTokens();
  const themeRef = useRef<ThemeTokens>(theme);
  useEffect(() => {
    roleRef.current = role;
    langRef.current = language;
    themeRef.current = theme;
  }, [role, language, theme]);

  /** The role emblem for the card backs, kept out of the mote list because
   *  it belongs to the stage rather than to any one perk. */
  const emblemRef = useRef<HTMLImageElement | null>(null);
  useEffect(() => {
    const img = new Image();
    img.src = withBasePath(ROLE_EMBLEM[role]);
    emblemRef.current = img;
  }, [role]);

  const state = useRef({
    motes: [] as Mote[],
    hand: [] as Mote[],
    spin: 1,
    spinTarget: 1,
    dealAt: 0,
    /** How visible the funnel behind the hand is: 1 while rolling, less
     *  once a hand is on the table. It is never 0 — a dealt stage with the
     *  vortex switched off is just fog, which is what "lost the background"
     *  meant. */
    dim: 1,
    dimTarget: 1,
    /** When to let the fog settle again after a one-slot swap. */
    calmAt: 0,
    /** Slugs the current hand was dealt for, so a single-slot reroll can be
     *  told apart from a whole new build. */
    shown: [] as string[],
    /** Slots to swap in place, when only some of the build changed. */
    swap: [] as number[],
    W: 0,
    H: 0,
  });

  const poolKey = pool.map((p) => p.slug).join(",");
  const perkKey = perks.map((p) => p.slug).join(",");

  // Refill the funnel from whatever is actually rollable now.
  useEffect(() => {
    const sample = pool.slice(0, MAX_MOTES);
    state.current.motes = sample.map((perk, i) => {
      const img = new Image();
      img.src = withBasePath(perk.icon);
      return {
        perk,
        img,
        seed: sample.length > 1 ? i / (sample.length - 1) : 0.5,
        lane: (i * 2.399963) % TAU,
        bob: Math.random() * TAU,
        from: null,
        to: null,
        t0: 0,
        dur: 0,
        card: false,
      };
    });
    state.current.hand = [];
    // poolKey is the identity of `pool`; the array itself is fresh each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poolKey]);

  // A new build arrived. A whole new one spins the funnel up and redeals; a
  // single changed slot swaps just that card, because replaying the full
  // ritual for one perk claimed far more had happened than actually did.
  useEffect(() => {
    const s = state.current;
    if (perks.length === 0 || s.motes.length === 0) {
      s.hand = [];
      s.shown = [];
      return;
    }
    const changed = perks.map((p, i) => s.shown[i] !== p.slug);
    const partial =
      s.hand.length === perks.length && !changed.every(Boolean) && changed.some(Boolean);

    /** Claims a mote for `perk`, reusing the funnel's own copy where it has
     *  one and otherwise repointing a spare.
     *
     *  It writes the repointed mote back into `arr` itself, which is the
     *  whole point: an earlier version returned a fresh object and left the
     *  caller to insert it, the caller looked it up by slug, found nothing
     *  (the slug was new to the funnel) and dropped it — so two of four cards
     *  were in the hand, counted, announced, and never drawn. */
    function takeMote(
      perk: (typeof perks)[number],
      arr: Mote[],
      taken: Set<Mote>,
    ): Mote | null {
      const own = arr.find((m) => m.perk.slug === perk.slug && !taken.has(m));
      if (own) {
        taken.add(own);
        return own;
      }
      const spareAt = arr.findIndex((m) => !taken.has(m));
      if (spareAt < 0) return null;
      const img = new Image();
      img.src = withBasePath(perk.icon);
      const repointed: Mote = { ...arr[spareAt], perk, img };
      arr[spareAt] = repointed;
      taken.add(repointed);
      return repointed;
    }

    if (partial) {
      // Keep every settled card exactly where it is; only the changed slots
      // move. The outgoing card is not animated away — the incoming one flips
      // over it, which is what a swap looks like at a table.
      const next = [...s.motes];
      const hand = [...s.hand];
      const taken = new Set<Mote>(hand);
      const now = performance.now() / 1000;
      changed.forEach((didChange, i) => {
        if (!didChange) return;
        const replacement = takeMote(perks[i], next, taken);
        if (!replacement) return;
        const old = hand[i];
        const slot = ritualCardRect(s.W, s.H, i, perks.length);
        const centre = { x: slot.x + slot.w / 2, y: slot.y + slot.h / 2, s: slot.w / ICON_PX };
        // Comes in off the funnel ring rather than from nowhere, so a
        // single-slot reroll still reads as "pulled out of the vortex".
        const entry = funnelPoint(replacement, s.W, s.H, now, s.spin, 1);
        const incoming: Mote = {
          ...replacement,
          from: { x: entry.x, y: entry.y, s: centre.s * 0.55, a: 0.2 },
          to: { x: centre.x, y: centre.y, s: centre.s, a: 1 },
          t0: now,
          dur: 0.58,
          card: true,
        };
        const at = next.indexOf(replacement);
        if (at >= 0) next[at] = incoming;
        else next.push(incoming);
        // The card being replaced drops out of the hand and out of the funnel.
        const oldAt = next.indexOf(old);
        if (oldAt >= 0) {
          next[oldAt] = {
            ...old,
            from: { x: centre.x, y: centre.y, s: centre.s, a: 1 },
            to: { x: centre.x, y: centre.y - slot.h * 0.4, s: centre.s * 0.9, a: 0 },
            t0: now,
            dur: 0.3,
            card: true,
          };
        }
        hand[i] = incoming;
      });
      s.motes = next;
      s.hand = hand;
      s.shown = perks.map((p) => p.slug);
      // The fog wakes up for the swap and settles again. Without this the
      // background sat perfectly still while a card changed, which read as
      // nothing having happened.
      s.spinTarget = 0.95;
      s.dimTarget = 0.75;
      s.calmAt = performance.now() / 1000 + 0.8;
      if (hostRef.current) {
        hostRef.current.dataset.shown = hand.map((m) => m.perk.slug).join(",");
      }
      return;
    }

    // Rebuilt rather than reset in place. Every mote starts a roll with no
    // tween on it, and a fresh array is both clearer than clearing three
    // fields on each one and the shape the compiler can actually verify.
    const fresh: Mote[] = s.motes.map((m) => ({
      ...m,
      from: null,
      to: null,
      card: false,
    }));
    const taken = new Set<Mote>();
    const hand: Mote[] = [];
    for (const perk of perks) {
      const mote = takeMote(perk, fresh, taken);
      if (!mote) break;
      hand.push(mote);
    }
    s.motes = fresh;
    s.hand = hand;
    s.shown = perks.map((p) => p.slug);
    /* The perks this stage will actually deal, taken from the hand it built
       rather than from the props — see the same attribute on SlotsStage. */
    if (hostRef.current) {
      hostRef.current.dataset.shown = hand.map((m) => m.perk.slug).join(",");
    }
    s.spinTarget = 1.5;
    s.dim = 1;
    s.dimTarget = 1;
    s.calmAt = 0;
    s.dealAt = performance.now() / 1000 + 0.45;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perkKey]);

  useEffect(() => {
    const host = hostRef.current;
    const fog = fogRef.current;
    const sprite = spriteRef.current;
    if (!host || !fog || !sprite) return;
    const ctx = sprite.getContext("2d");
    if (!ctx) return;
    const s = state.current;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const gl = fog.getContext("webgl", { antialias: false, alpha: false });
    const uni: Record<string, WebGLUniformLocation | null> = {};
    if (gl) {
      const compile = (type: number, src: string) => {
        const sh = gl.createShader(type)!;
        gl.shaderSource(sh, src);
        gl.compileShader(sh);
        return sh;
      };
      const prog = gl.createProgram()!;
      gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(prog);
      gl.useProgram(prog);
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, "p");
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      uni.res = gl.getUniformLocation(prog, "uRes");
      uni.time = gl.getUniformLocation(prog, "uTime");
      uni.spin = gl.getUniformLocation(prog, "uSpin");
      uni.tint = gl.getUniformLocation(prog, "uTint");
      uni.ground = gl.getUniformLocation(prog, "uGround");
      uni.haze = gl.getUniformLocation(prog, "uHaze");
      uni.tintAmt = gl.getUniformLocation(prog, "uTintAmt");
    }

    let dpr = 1;
    const measure = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      s.W = host.clientWidth;
      s.H = host.clientHeight;
      for (const c of [fog, sprite]) {
        c.width = Math.max(1, Math.round(s.W * dpr));
        c.height = Math.max(1, Math.round(s.H * dpr));
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (gl) gl.viewport(0, 0, fog.width, fog.height);
      // Mirrored into React state so the DOM control layer can be laid out
      // from the same numbers the canvas paints with.
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

    const easeOut = (x: number) => 1 - Math.pow(1 - x, 3);

    function slotFor(i: number, n: number) {
      const r = ritualCardRect(s.W, s.H, i, n);
      return { x: r.x + r.w / 2, y: r.y + r.h / 2, s: r.w / ICON_PX };
    }

    const funnel = (m: Mote, time: number) =>
      funnelPoint(m, s.W, s.H, time, s.spin, s.dim);

    function beginDeal(time: number) {
      s.spinTarget = 0.22;
      s.hand.forEach((m, i) => {
        const slot = slotFor(i, s.hand.length);
        const now = funnel(m, time);
        m.from = { x: now.x, y: now.y, s: now.s, a: 1 };
        m.to = { x: slot.x, y: slot.y, s: slot.s, a: 1 };
        m.t0 = time + i * 0.08;
        m.dur = reduced ? 0.01 : 0.66;
        m.card = true;
      });
      // Everything not in the hand stays in the funnel and keeps turning —
      // it just steps back. Tweening it to zero alpha, as this used to, left
      // the stage with nothing but fog the moment the first hand landed.
      s.dimTarget = 0.5;
      for (const m of s.motes) {
        if (s.hand.includes(m)) continue;
        m.from = null;
        m.to = null;
        m.card = false;
      }
    }

    function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
      c.beginPath();
      c.moveTo(x + r, y);
      c.arcTo(x + w, y, x + w, y + h, r);
      c.arcTo(x + w, y + h, x, y + h, r);
      c.arcTo(x, y + h, x, y, r);
      c.arcTo(x, y, x + w, y, r);
      c.closePath();
    }

    function drawCard(m: Mote, p: { x: number; y: number; s: number; a: number; flip: number }) {
      const accent = ROLE_COLOR[roleRef.current].solid;
      const th = themeRef.current;
      const size = ICON_PX * p.s;
      const cw = size * 1.06;
      const ch = cw * 1.4;
      const faceUp = p.flip > 0.5;
      ctx!.save();
      ctx!.globalAlpha = Math.max(0, Math.min(1, p.a));
      ctx!.translate(p.x, p.y);
      ctx!.scale(Math.abs(Math.cos(Math.min(1, p.flip) * Math.PI)) || 0.02, 1);
      ctx!.save();
      ctx!.shadowColor = "rgba(0,0,0,0.6)";
      ctx!.shadowBlur = 22;
      ctx!.shadowOffsetY = 8;
      // The card is the site's own surface, not a fixed dark slab.
      ctx!.fillStyle = faceUp ? th.surface : th.background;
      roundRect(ctx!, -cw / 2, -ch / 2, cw, ch, cw * 0.09);
      ctx!.fill();
      ctx!.restore();
      ctx!.strokeStyle = faceUp ? `${accent}88` : th.border;
      ctx!.lineWidth = 1;
      roundRect(ctx!, -cw / 2, -ch / 2, cw, ch, cw * 0.09);
      ctx!.stroke();
      if (faceUp) {
        if (m.img.complete && m.img.naturalWidth) {
          // Perk art is white line work. On the light theme the page inverts
          // it with CSS (.icon-art); a canvas gets no cascade, so it does the
          // same inversion here at the same strength.
          if (th.isLight) ctx!.filter = "invert(0.92)";
          ctx!.drawImage(m.img, -size / 2, -ch / 2 + cw * 0.12, size, size);
          ctx!.filter = "none";
        }
        ctx!.fillStyle = th.foreground;
        ctx!.font = `500 ${Math.max(9, cw * 0.1)}px Oswald, "Arial Narrow", sans-serif`;
        ctx!.textAlign = "center";
        const name = m.perk.name[langRef.current].toUpperCase();
        let line = name;
        while (ctx!.measureText(line).width > cw * 0.86 && line.length > 4) line = line.slice(0, -1);
        ctx!.fillText(line === name ? name : `${line}…`, 0, ch / 2 - cw * 0.12);
      } else {
        // The role's own emblem from the game — the skull for Killer, the
        // gear for Survivor — rather than the drawn cross that used to sit
        // here, which read as a placeholder because it was one.
        const emblem = emblemRef.current;
        if (emblem?.complete && emblem.naturalWidth) {
          const e = cw * 0.46;
          ctx!.globalAlpha *= 0.85;
          // White line art, like the perk icons: inverted on the light theme
          // exactly as .icon-art does for the rest of the page.
          if (th.isLight) ctx!.filter = "invert(0.92)";
          ctx!.drawImage(emblem, -e / 2, -e / 2, e, e);
          ctx!.filter = "none";
        }
      }
      ctx!.restore();
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
    let dealt = false;
    function frame(now: number) {
      const time = now / 1000;
      const dt = Math.min(0.05, time - last);
      last = time;
      s.spin += (s.spinTarget - s.spin) * Math.min(1, dt * 2.6);
      s.dim += (s.dimTarget - s.dim) * Math.min(1, dt * 3);
      if (s.calmAt && time >= s.calmAt) {
        s.spinTarget = 0.22;
        s.dimTarget = 0.5;
        s.calmAt = 0;
      }

      if (s.dealAt && time >= s.dealAt) {
        beginDeal(time);
        s.dealAt = 0;
        dealt = true;
      }
      void dealt;

      if (gl) {
        gl.uniform2f(uni.res, fog!.width, fog!.height);
        gl.uniform1f(uni.time, time);
        gl.uniform1f(uni.spin, s.spin);
        const tint = MOOD[roleRef.current];
        const th = themeRef.current;
        gl.uniform3f(uni.tint, tint[0], tint[1], tint[2]);
        gl.uniform3f(uni.ground, th.groundRgb[0], th.groundRgb[1], th.groundRgb[2]);
        gl.uniform3f(uni.haze, th.hazeRgb[0], th.hazeRgb[1], th.hazeRgb[2]);
        // The tint has to be gentler on a light ground: the same amount that
        // reads as ember on near-black turns a white page pink.
        gl.uniform1f(uni.tintAmt, th.isLight ? 0.18 : 0.85);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }

      ctx!.clearRect(0, 0, s.W, s.H);
      const list: Array<{ m: Mote; p: { x: number; y: number; s: number; a: number; flip: number }; card: boolean; z: number }> = [];
      for (const m of s.motes) {
        if (m.from && m.to) {
          const k = Math.max(0, Math.min(1, (time - m.t0) / m.dur));
          const e = easeOut(k);
          const p = {
            x: m.from.x + (m.to.x - m.from.x) * e,
            y: m.from.y + (m.to.y - m.from.y) * e,
            s: m.from.s + (m.to.s - m.from.s) * e,
            a: m.from.a + (m.to.a - m.from.a) * e,
            flip: m.card ? Math.max(0, Math.min(1, (k - 0.45) / 0.55)) : 0,
          };
          list.push({ m, p, card: m.card, z: m.card ? 2 : 0 });
        } else {
          const f = funnel(m, time);
          list.push({ m, p: { ...f, flip: 0 }, card: false, z: f.z });
        }
      }
      list.sort((a, b) => a.z - b.z);
      for (const d of list) {
        if (d.card) {
          drawCard(d.m, d.p);
        } else if (d.m.img.complete && d.m.img.naturalWidth) {
          const size = ICON_PX * d.p.s;
          ctx!.save();
          ctx!.globalAlpha = Math.max(0, Math.min(1, d.p.a));
          if (themeRef.current.isLight) ctx!.filter = "invert(0.92)";
          ctx!.drawImage(d.m.img, d.p.x - size / 2, d.p.y - size / 2, size, size);
          ctx!.restore();
        }
      }
      raf = visible && onScreen ? requestAnimationFrame(frame) : 0;
    }
    pump();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      // Release the GPU context rather than waiting for the collector — a
      // handful of theme switches otherwise hits the browser's live-context
      // cap and every later canvas silently fails to get one.
      gl?.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, []);

  return (
    <div
      ref={hostRef}
      data-testid="ritual-stage"
      /* Intrinsic width, not `w-full`. The board nests the stage inside a
         shrink-to-fit `items-center` column, so a percentage width was
         circular — the column sized itself to its widest child (the
         toolbar) and the stage then took 100% of that, coming out 559px
         wide on a 1920 screen no matter what max-width it was given.
         The viewport term keeps it inside the page padding on a phone. */
      className="relative aspect-[16/7] w-[min(64rem,calc(100vw-3rem))] overflow-hidden rounded-2xl border border-border"
      style={{ background: theme.stageGround }}
    >
      <canvas ref={fogRef} className="absolute inset-0 size-full" aria-hidden />
      <canvas ref={spriteRef} className="absolute inset-0 size-full" aria-hidden />
      {/* The build is on the canvas, which a screen reader cannot see. */}
      <ul className="sr-only">
        {perks.map((p) => (
          <li key={p.slug}>{p.name[language]}</li>
        ))}
      </ul>
      <StageControls
        perks={perks}
        language={language}
        rects={perks.map((_, i) => ritualCardRect(size.w, size.h, i, perks.length))}
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
