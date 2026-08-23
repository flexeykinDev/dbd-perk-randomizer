"use client";

// The site's own colours, resolved, for the things that paint themselves.
//
// A canvas cannot inherit a CSS variable — it gets numbers, once, at draw
// time. So the presentation stages read the same custom properties the rest
// of the page is styled from and repaint when the theme changes. Hardcoding a
// dark ground instead is what made them a black slab in the middle of the
// light theme.
//
// This is deliberately NOT what the export card does: that paints its own
// dark ground on purpose and never follows the site (see the comment on
// .icon-art in app/globals.css). A stage sits inside the page and has to
// match it.
import { useEffect, useState } from "react";

export interface ThemeTokens {
  isLight: boolean;
  /** Page ground. */
  background: string;
  /** One step up from the ground — panels, cards. */
  surface: string;
  border: string;
  foreground: string;
  muted: string;
  /** Ground and haze as 0..1 RGB triples, for shader uniforms. */
  groundRgb: [number, number, number];
  hazeRgb: [number, number, number];
  /** The ground a full-bleed effect should paint, as a CSS colour. */
  stageGround: string;
}

function readVar(styles: CSSStyleDeclaration, name: string, fallback: string): string {
  const value = styles.getPropertyValue(name).trim();
  return value || fallback;
}

/** #rgb / #rrggbb / rgb(...) → 0..1 triple. Anything unparseable falls back
 *  to mid grey rather than throwing: a wrong colour is a cosmetic bug, an
 *  exception in a draw loop is a blank stage. */
export function toRgb(colour: string): [number, number, number] {
  const hex = colour.trim();
  if (hex.startsWith("#")) {
    const h = hex.slice(1);
    const full =
      h.length === 3
        ? h
            .split("")
            .map((c) => c + c)
            .join("")
        : h;
    if (full.length >= 6) {
      const n = parseInt(full.slice(0, 6), 16);
      if (!Number.isNaN(n)) {
        return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
      }
    }
  }
  const m = /rgba?\(([^)]+)\)/.exec(hex);
  if (m) {
    const parts = m[1].split(",").map((p) => parseFloat(p));
    if (parts.length >= 3 && parts.every((p) => !Number.isNaN(p))) {
      return [parts[0] / 255, parts[1] / 255, parts[2] / 255];
    }
  }
  return [0.5, 0.5, 0.5];
}

function shade([r, g, b]: [number, number, number], amount: number): [number, number, number] {
  const f = (c: number) => Math.max(0, Math.min(1, c + amount));
  return [f(r), f(g), f(b)];
}

export function readThemeTokens(): ThemeTokens {
  if (typeof document === "undefined") {
    return {
      isLight: false,
      background: "#121212",
      surface: "#1e2228",
      border: "#30353d",
      foreground: "#edeef0",
      muted: "#9096a3",
      groundRgb: [0.05, 0.052, 0.062],
      hazeRgb: [0.12, 0.13, 0.15],
      stageGround: "#0d0d10",
    };
  }
  const styles = getComputedStyle(document.documentElement);
  const isLight = document.documentElement.dataset.theme === "light";
  const background = readVar(styles, "--background", isLight ? "#f7f8f9" : "#121212");
  const surface = readVar(styles, "--surface", isLight ? "#ffffff" : "#1e2228");
  /* The stage sinks slightly below the page it sits in.
   *
   * --background on the dark theme is #121212 — a light, neutral grey by the
   * standards of a fog effect, and painting the vortex straight onto it left
   * nothing for the haze to be brighter *than*: the whole thing washed out to
   * flat grey and read as no background at all. A few points down gives the
   * fog somewhere to sit while still being derived from the theme, so the
   * light variant stays light. */
  const rawGround = toRgb(background);
  const groundRgb = shade(rawGround, isLight ? 0.012 : -0.045);
  return {
    isLight,
    background,
    surface,
    border: readVar(styles, "--border", isLight ? "#e2e5e9" : "#30353d"),
    foreground: readVar(styles, "--foreground", isLight ? "#14161b" : "#edeef0"),
    muted: readVar(styles, "--muted", isLight ? "#62697a" : "#9096a3"),
    groundRgb,
    stageGround: `rgb(${groundRgb.map((c) => Math.round(c * 255)).join(",")})`,
    /* Haze reads as light on a dark page and as shadow on a light one.
     *
     * The amount matters more than it looks: --background on the dark theme
     * is #121212, considerably lighter and greyer than the near-black the fog
     * was originally drawn against, so a small delta washed the whole vortex
     * into flat grey and the effect was reported as simply gone. The cool
     * lift on dark puts back the blue the neutral ground does not carry. */
    hazeRgb: isLight
      ? shade(groundRgb, -0.13)
      : [groundRgb[0] + 0.1, groundRgb[1] + 0.125, groundRgb[2] + 0.175],
  };
}

/** Re-reads whenever the theme toggle flips `data-theme` on <html>. */
export function useThemeTokens(): ThemeTokens {
  const [tokens, setTokens] = useState<ThemeTokens>(() => readThemeTokens());

  useEffect(() => {
    function syncThemeTokens() {
      setTokens(readThemeTokens());
    }
    syncThemeTokens();
    const observer = new MutationObserver(syncThemeTokens);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);

  return tokens;
}
