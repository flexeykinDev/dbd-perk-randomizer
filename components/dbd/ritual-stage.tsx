"use client";

import { useEffect, useRef } from "react";
import { withBasePath } from "@/lib/asset-path";
import { ROLE_COLOR } from "@/lib/role-color";
import type { Perk, PerkRole } from "@/lib/types";

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
const MAX_MOTES = 22;

const MOOD: Record<PerkRole, [number, number, number]> = {
  killer: [0.886, 0.408, 0.376],
  survivor: [0.345, 0.698, 0.886],
};

const VERT = "attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }";

const FRAG = `
precision highp float;
uniform vec2 uRes; uniform float uTime; uniform float uSpin; uniform vec3 uTint;
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
  float funnel = smoothstep(0.05, 0.72, r) * (1.0 - smoothstep(0.85, 1.5, r));
  float dens = pow(d, 1.7) * funnel;
  vec3 col = mix(vec3(0.027, 0.031, 0.043), vec3(0.078, 0.094, 0.133), dens * 1.5);
  col += uTint * dens * (0.55 + 0.45 * uSpin);
  col += uTint * 0.14 * smoothstep(0.4, 0.0, r) * (0.4 + 0.6 * uSpin);
  col *= 1.0 - 0.45 * smoothstep(0.62, 1.5, r);
  col += (hash(gl_FragCoord.xy + fract(uTime) * 91.0) - 0.5) * 0.02;
  gl_FragColor = vec4(col, 1.0);
}`;

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
}: {
  pool: Perk[];
  perks: Perk[];
  role: PerkRole;
  language: "en" | "ru";
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const fogRef = useRef<HTMLCanvasElement>(null);
  const spriteRef = useRef<HTMLCanvasElement>(null);
  // The draw loop is mounted once and reads these live. Assigned in an
  // effect rather than during render: a ref written while rendering is not
  // safe under concurrent rendering, and the compiler rejects it.
  const roleRef = useRef(role);
  const langRef = useRef(language);
  useEffect(() => {
    roleRef.current = role;
    langRef.current = language;
  }, [role, language]);

  const state = useRef({
    motes: [] as Mote[],
    hand: [] as Mote[],
    spin: 1,
    spinTarget: 1,
    dealAt: 0,
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

  // A new build arrived — spin up, then deal exactly it.
  useEffect(() => {
    const s = state.current;
    if (perks.length === 0 || s.motes.length === 0) {
      s.hand = [];
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
      let mote = fresh.find((m) => m.perk.slug === perk.slug && !taken.has(m));
      if (!mote) {
        // The rolled perk is outside the funnel's sample — repoint a spare so
        // the hand always shows the real build rather than a subset of it.
        const spare = fresh.find((m) => !taken.has(m));
        if (!spare) break;
        const img = new Image();
        img.src = withBasePath(perk.icon);
        mote = { ...spare, perk, img };
        fresh[fresh.indexOf(spare)] = mote;
      }
      taken.add(mote);
      hand.push(mote);
    }
    s.motes = fresh;
    s.hand = hand;
    /* The perks this stage will actually deal, taken from the hand it built
       rather than from the props — see the same attribute on SlotsStage. */
    if (hostRef.current) {
      hostRef.current.dataset.shown = hand.map((m) => m.perk.slug).join(",");
    }
    s.spinTarget = 1.9;
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
      const cw = Math.min(132, Math.max(72, s.W / (n + 2.4)));
      const gap = cw * 0.3;
      const total = n * cw + (n - 1) * gap;
      return { x: s.W / 2 - total / 2 + i * (cw + gap) + cw / 2, y: s.H * 0.52, s: cw / ICON_PX };
    }

    function funnel(m: Mote, time: number) {
      const radius = Math.min(s.W * 0.46, s.H * 0.95) * (0.34 + 0.5 * m.seed * m.seed);
      const speed = (0.42 + 0.5 * (1 - m.seed)) * (0.35 + 0.65 * s.spin);
      const ang = m.lane + time * speed;
      const depth = Math.sin(ang) * 0.5 + 0.5;
      return {
        x: s.W / 2 + Math.cos(ang) * radius * (0.92 + 0.16 * depth),
        y: s.H * 0.5 - (m.seed - 0.5) * s.H * 0.62 + Math.sin(time * 0.7 + m.bob) * 6,
        s: (0.3 + 0.34 * depth) * (Math.min(s.W, s.H) / 620 + 0.4),
        a: 0.2 + 0.8 * depth,
        z: Math.sin(ang),
      };
    }

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
      for (const m of s.motes) {
        if (s.hand.includes(m)) continue;
        const now = funnel(m, time);
        m.from = { x: now.x, y: now.y, s: now.s, a: now.a };
        m.to = {
          x: s.W / 2 + (now.x - s.W / 2) * 2.2,
          y: now.y + (now.y - s.H / 2) * 0.7,
          s: now.s * 0.6,
          a: 0,
        };
        m.t0 = time;
        m.dur = reduced ? 0.01 : 0.45;
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
      const grad = ctx!.createLinearGradient(0, -ch / 2, 0, ch / 2);
      grad.addColorStop(0, faceUp ? "rgba(30,34,44,0.96)" : "rgba(22,25,33,0.98)");
      grad.addColorStop(1, faceUp ? "rgba(12,14,19,0.98)" : "rgba(9,11,15,0.99)");
      ctx!.fillStyle = grad;
      roundRect(ctx!, -cw / 2, -ch / 2, cw, ch, cw * 0.09);
      ctx!.fill();
      ctx!.restore();
      ctx!.strokeStyle = faceUp ? `${accent}66` : "rgba(232,228,220,0.14)";
      ctx!.lineWidth = 1;
      roundRect(ctx!, -cw / 2, -ch / 2, cw, ch, cw * 0.09);
      ctx!.stroke();
      if (faceUp) {
        if (m.img.complete && m.img.naturalWidth) {
          ctx!.drawImage(m.img, -size / 2, -ch / 2 + cw * 0.12, size, size);
        }
        ctx!.fillStyle = "#e8e4dc";
        ctx!.font = `500 ${Math.max(9, cw * 0.1)}px Oswald, "Arial Narrow", sans-serif`;
        ctx!.textAlign = "center";
        const name = m.perk.name[langRef.current].toUpperCase();
        let line = name;
        while (ctx!.measureText(line).width > cw * 0.86 && line.length > 4) line = line.slice(0, -1);
        ctx!.fillText(line === name ? name : `${line}…`, 0, ch / 2 - cw * 0.12);
      } else {
        // The Entity's mark — the one place gold is spent.
        ctx!.strokeStyle = "#c9a227";
        ctx!.globalAlpha *= 0.7;
        ctx!.lineWidth = 1.3;
        const r = cw * 0.19;
        ctx!.beginPath();
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * TAU - Math.PI / 4;
          ctx!.moveTo(0, 0);
          ctx!.lineTo(Math.cos(a) * r, Math.sin(a) * r);
        }
        ctx!.stroke();
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
        gl.uniform3f(uni.tint, tint[0] * 0.5, tint[1] * 0.5, tint[2] * 0.5);
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
      className="relative aspect-[16/7] w-full max-w-4xl overflow-hidden rounded-2xl border border-border bg-[#07080b]"
    >
      <canvas ref={fogRef} className="absolute inset-0 size-full" aria-hidden />
      <canvas ref={spriteRef} className="absolute inset-0 size-full" aria-hidden />
      {/* The build is on the canvas, which a screen reader cannot see. */}
      <ul className="sr-only">
        {perks.map((p) => (
          <li key={p.slug}>{p.name[language]}</li>
        ))}
      </ul>
    </div>
  );
}
