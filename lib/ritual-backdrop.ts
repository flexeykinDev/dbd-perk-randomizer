"use client";

import { RITUAL_FRAG, RITUAL_VERT } from "./ritual-fog";
import type { PerkRole } from "./types";

/* The vortex, painted once and baked into the export image.
 *
 * Every share card looked identical apart from the icons on it. The fog is
 * the most distinctive thing the site draws, so the picture that leaves the
 * site now carries it — and carries a different one for every build.
 *
 * Deterministic on purpose. The seed comes from the build's own slugs rather
 * than from the clock, so re-exporting the same build, or opening the same
 * share link tomorrow, produces the same artwork. Random-per-click would look
 * identical in a screenshot and be wrong in the way that matters: the image
 * would stop being a picture OF that build.
 *
 * Rendered offscreen and handed over as a JPEG data URI. html2canvas cannot
 * rasterize a live WebGL canvas — it copies DOM, and a canvas element it did
 * not draw comes out blank — so the shader has to finish first and hand over
 * pixels. JPEG rather than PNG because this is soft noise at large scale:
 * the PNG of the same frame is several times the size and no better to look
 * at once it is behind a scrim.
 */

/** Matches the stage's own MOOD, so the export reads as the same scene. */
const TINT: Record<PerkRole, [number, number, number]> = {
  killer: [0.886, 0.408, 0.376],
  survivor: [0.345, 0.698, 0.886],
};

/** The export card's ground, as the shader wants it: 0..1 linear-ish RGB. */
const GROUND: [number, number, number] = [0.039, 0.047, 0.063];
const HAZE: [number, number, number] = [0.22, 0.25, 0.32];

/** Half the card's width. The fog has no detail worth a 1:1 render, and this
 *  keeps the embedded image small enough not to dominate the download. */
const RENDER_SCALE = 0.5;

/** FNV-1a. Any stable hash would do; this one is short and has no
 *  dependencies. */
function seedFrom(parts: string[]): number {
  let h = 0x811c9dc5;
  for (const part of parts.join("|")) {
    h ^= part.charCodeAt(0);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function compile(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

export interface BackdropRequest {
  /** The card's pixel size; the render is scaled down from this. */
  width: number;
  height: number;
  role: PerkRole;
  /** Whatever identifies this build — slugs, in the order they were rolled. */
  parts: string[];
}

/**
 * Paints one frame of the vortex for this build.
 *
 * Returns a `data:` URI, or `null` when WebGL is unavailable — which is a
 * normal outcome, not an error: the card is designed to look finished without
 * it, and a browser that refuses a context should still get its download.
 */
export function renderRitualBackdrop({
  width,
  height,
  role,
  parts,
}: BackdropRequest): string | null {
  if (typeof document === "undefined") return null;

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * RENDER_SCALE));
  canvas.height = Math.max(1, Math.round(height * RENDER_SCALE));

  // preserveDrawingBuffer, because the whole point is to read the pixels back
  // after the draw. Without it the buffer is free to be cleared the moment
  // the draw call returns and toDataURL hands back an empty frame.
  const gl = canvas.getContext("webgl", {
    preserveDrawingBuffer: true,
    antialias: false,
    alpha: false,
  }) as WebGLRenderingContext | null;
  if (!gl) return null;

  const program = gl.createProgram();
  const vert = compile(gl, gl.VERTEX_SHADER, RITUAL_VERT);
  const frag = compile(gl, gl.FRAGMENT_SHADER, RITUAL_FRAG);
  if (!program || !vert || !frag) return null;
  gl.attachShader(program, vert);
  gl.attachShader(program, frag);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
  gl.useProgram(program);

  // One full-screen triangle; the shader does the rest from gl_FragCoord.
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, "p");
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

  const seed = seedFrom(parts);
  /* The two dials that decide what this particular vortex looks like.
   *
   * `time` moves the noise field, so it is what actually makes two builds
   * look different; the range is arbitrary but wide enough that neighbouring
   * seeds land nowhere near each other. `spin` sets how hard the funnel is
   * twisting, kept in the upper half of its range because a slack vortex
   * reads as a smudge rather than as a vortex. */
  const time = (seed % 100000) / 97;
  const spin = 0.75 + ((seed >>> 16) % 1000) / 4000;

  const uni = (name: string) => gl.getUniformLocation(program, name);
  gl.uniform2f(uni("uRes"), canvas.width, canvas.height);
  gl.uniform1f(uni("uTime"), time);
  gl.uniform1f(uni("uSpin"), spin);
  gl.uniform3f(uni("uTint"), ...TINT[role]);
  gl.uniform3f(uni("uGround"), ...GROUND);
  gl.uniform3f(uni("uHaze"), ...HAZE);
  // Stronger than the stage's 0.85: this sits under a darkening scrim on the
  // card, and the tint is most of what says "killer" or "survivor" at a
  // glance once the fog is dimmed.
  gl.uniform1f(uni("uTintAmt"), 1);

  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.drawArrays(gl.TRIANGLES, 0, 3);

  try {
    return canvas.toDataURL("image/jpeg", 0.82);
  } catch {
    // A tainted or oversized canvas; the card does without.
    return null;
  }
}
