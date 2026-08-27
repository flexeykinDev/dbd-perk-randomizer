"use client";

import { useEffect, useMemo, useRef } from "react";
import { RITUAL_FRAG, RITUAL_VERT } from "@/lib/ritual-fog";
import { renderRitualBackdrop } from "@/lib/ritual-backdrop";
import { ROLE_COLOR } from "@/lib/role-color";
import { useThemeTokens } from "@/lib/theme-tokens";
import type { ObsBackground, ObsMotion } from "@/lib/use-obs-mode";
import type { PerkRole } from "@/lib/types";

/* What sits behind the overlay's cards.
 *
 * Transparent is and stays the default — an overlay already in somebody's
 * scene must not change appearance because this shipped. The rest are skins:
 * the Ritual fog, or the Slots machine's ground.
 *
 * This runs inside OBS's embedded browser, on a machine that is also encoding
 * video, so everything here is written to be cheap or to stop: the shader
 * pauses when the source is hidden, and there is a still fallback that costs
 * one draw per build.
 */

const MOOD: Record<PerkRole, [number, number, number]> = {
  killer: [0.886, 0.408, 0.376],
  survivor: [0.345, 0.698, 0.886],
};

/** The Ritual fog, live. Same shader the Ritual stage runs — imported rather
 *  than copied, so the two cannot drift into different weather. */
function VortexCanvas({ role }: { role: PerkRole }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const theme = useThemeTokens();
  const themeRef = useRef(theme);
  const roleRef = useRef(role);
  useEffect(() => {
    themeRef.current = theme;
    roleRef.current = role;
  }, [theme, role]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Same reason as `gl` below: the draw loop is a function declaration and
    // would otherwise lose the null narrowing.
    const canvas: HTMLCanvasElement = el;
    const ctx = canvas.getContext("webgl", { antialias: false, alpha: true });
    if (!ctx) return;
    // Bound to a const so the draw loop below keeps the narrowing — a function
    // declaration loses it.
    const gl: WebGLRenderingContext = ctx;

    const uni: Record<string, WebGLUniformLocation | null> = {};
    function build(gl: WebGLRenderingContext) {
      const compile = (type: number, src: string) => {
        const sh = gl.createShader(type)!;
        gl.shaderSource(sh, src);
        gl.compileShader(sh);
        return sh;
      };
      const prog = gl.createProgram()!;
      gl.attachShader(prog, compile(gl.VERTEX_SHADER, RITUAL_VERT));
      gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, RITUAL_FRAG));
      gl.linkProgram(prog);
      gl.useProgram(prog);
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, "p");
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      for (const name of ["uRes", "uTime", "uSpin", "uTint", "uGround", "uHaze", "uTintAmt"]) {
        uni[name] = gl.getUniformLocation(prog, name);
      }
    }

    let ready = false;
    build(gl);
    ready = true;

    /* Without preventDefault the browser never fires `restored`, and the
       canvas stays dead for the life of the page — which on a stream overlay
       means until the streamer notices and reloads the source. */
    const onLost = (e: Event) => {
      e.preventDefault();
      ready = false;
    };
    const onRestored = () => {
      build(gl);
      gl.viewport(0, 0, canvas.width, canvas.height);
      ready = true;
    };
    canvas.addEventListener("webglcontextlost", onLost);
    canvas.addEventListener("webglcontextrestored", onRestored);

    const measure = () => {
      // Capped at 1x. This is a background of moving fog behind other
      // elements; a retina buffer costs four times the fill for detail
      // nothing in it resolves.
      canvas.width = Math.max(1, canvas.clientWidth);
      canvas.height = Math.max(1, canvas.clientHeight);
      if (ready) gl.viewport(0, 0, canvas.width, canvas.height);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(canvas);

    /* OBS keeps a hidden browser source running unless "shutdown when not
       visible" is ticked, which most scenes do not tick. Pausing on
       visibilitychange is what stops this costing a frame's GPU sixty times a
       second while the streamer is on another scene. */
    let raf = 0;
    let visible = !document.hidden;
    const start = performance.now();

    function frame() {
      if (ready) {
        const th = themeRef.current;
        const tint = MOOD[roleRef.current];
        gl.uniform2f(uni.uRes, canvas.width, canvas.height);
        gl.uniform1f(uni.uTime, (performance.now() - start) / 1000);
        // A slow, settled drift. The stage spins up on a roll; an overlay
        // just breathes.
        gl.uniform1f(uni.uSpin, 0.32);
        gl.uniform3f(uni.uTint, tint[0], tint[1], tint[2]);
        gl.uniform3f(uni.uGround, th.groundRgb[0], th.groundRgb[1], th.groundRgb[2]);
        gl.uniform3f(uni.uHaze, th.hazeRgb[0], th.hazeRgb[1], th.hazeRgb[2]);
        gl.uniform1f(uni.uTintAmt, th.isLight ? 0.18 : 0.85);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      raf = visible ? requestAnimationFrame(frame) : 0;
    }
    const pump = () => {
      visible = !document.hidden;
      if (visible && !raf) raf = requestAnimationFrame(frame);
      else if (!visible && raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    };
    document.addEventListener("visibilitychange", pump);
    pump();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      document.removeEventListener("visibilitychange", pump);
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
      // Release the GPU context rather than waiting for the collector — a
      // browser source that reloads repeatedly would otherwise hit the live
      // context cap and get nothing back.
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, []);

  return <canvas ref={ref} className="fixed inset-0 -z-10 size-full" aria-hidden />;
}

/** One picture per build, from the same renderer the share card uses. Costs a
 *  single draw when the build changes and nothing at all in between. */
function VortexStill({ role, buildKey }: { role: PerkRole; buildKey: string }) {
  /* useMemo rather than state-in-an-effect: it is a pure function of the
     build, and drawing it into state would render once with nothing and then
     again with the picture. Returns null server-side on its own (see
     renderRitualBackdrop), which never happens here — the overlay view is
     client-only. Same shape useShareExport uses for the share card. */
  const src = useMemo(
    () =>
      renderRitualBackdrop({
        width: 1280,
        height: 720,
        role,
        parts: buildKey ? buildKey.split(",") : [],
      }),
    [role, buildKey],
  );
  if (!src) return null;
  return (
    <div className="fixed inset-0 -z-10" aria-hidden>
      {/* eslint-disable-next-line @next/next/no-img-element -- a data URI, and this view sits outside the app shell */}
      <img src={src} alt="" className="absolute inset-0 size-full object-cover" />
      {/* renderRitualBackdrop is tuned for the share card, which lays its own
          scrim over the top. Without one the fog comes out considerably
          brighter than the live shader and competes with the cards sitting on
          it — darkest in the middle, where the cards are, thinning to the
          corners where the fog is the only thing to look at. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 72% 64% at 50% 50%, rgba(10,12,16,0.86) 0%, rgba(10,12,16,0.78) 46%, rgba(10,12,16,0.52) 78%, rgba(10,12,16,0.34) 100%)",
        }}
      />
    </div>
  );
}

/** The Slots machine's ground: the cabinet behind the reels rather than the
 *  reels themselves, which are the cards' own framing (see ObsCardFrame). */
function SlotsBackdrop({ role }: { role: PerkRole }) {
  const theme = useThemeTokens();
  const accent = ROLE_COLOR[role].solid;
  return (
    <div className="fixed inset-0 -z-10" aria-hidden>
      <div
        className="absolute inset-0"
        style={{
          background: `linear-gradient(180deg, ${theme.stageGround} 0%, ${theme.surface} 50%, ${theme.stageGround} 100%)`,
        }}
      />
      {/* The cabinet's lit edge, top and bottom — the machine reads as a
          bounded object rather than a coloured rectangle. */}
      <div
        className="absolute inset-x-0 top-0 h-px"
        style={{ background: `linear-gradient(90deg, transparent, ${accent}aa 30%, ${accent}aa 70%, transparent)` }}
      />
      <div
        className="absolute inset-x-0 bottom-0 h-px"
        style={{ background: `linear-gradient(90deg, transparent, ${accent}aa 30%, ${accent}aa 70%, transparent)` }}
      />
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 70% 60% at 50% 50%, rgba(0,0,0,0) 40%, rgba(0,0,0,0.35) 100%)",
        }}
      />
    </div>
  );
}

export function ObsSkin({
  background,
  motion,
  role,
  buildKey,
}: {
  background: ObsBackground;
  motion: ObsMotion;
  role: PerkRole;
  /** The current build's slugs, comma-joined — identifies which picture the
   *  still fallback should draw. */
  buildKey: string;
}) {
  if (background === "vortex") {
    return motion === "still" ? (
      <VortexStill role={role} buildKey={buildKey} />
    ) : (
      <VortexCanvas role={role} />
    );
  }
  if (background === "slots") return <SlotsBackdrop role={role} />;
  // "transparent" and "dark" are handled by the page background itself — see
  // the effect in obs-overlay.tsx.
  return null;
}
