import type { PerkRole, ShareCardLayout } from "@/lib/types";
import { oswald, plexMono } from "@/lib/export-fonts";

/* The export card's own design tokens.
 *
 * Deliberately literal values, never `var(--…)`: the card is rasterised by
 * html2canvas, which cannot resolve a CSS custom property and fails silently
 * when handed one. That constraint is the reason this palette exists
 * separately from the site's theme at all, so it is worth its own file rather
 * than being twenty consts at the top of a 1,200-line component.
 *
 * It is also a single fixed palette on purpose — the card is a dark poster in
 * both site themes. */

export const GROUND = "#0a0c10";
export const BONE = "#e8e4dc";
export const HAIRLINE = "rgba(232,228,220,0.16)";
export const HAIRLINE_SOFT = "rgba(232,228,220,0.07)";
export const QUIET = "rgba(232,228,220,0.40)";
export const FAINT = "rgba(232,228,220,0.26)";

/** Condensed grotesque for names and perk labels; wide-tracked mono for the
 *  small uppercase labels and the footer. Literal family strings, never
 *  `var(--…)` — see the header. Loaded via lib/export-fonts.ts. */
export const DISPLAY = `${oswald.style.fontFamily}, "Arial Narrow", Arial, sans-serif`;
export const MONO = `${plexMono.style.fontFamily}, ui-monospace, "Courier New", monospace`;

/** Atmospheric tone per role: cool blue for Survivor, warm ember for Killer.
 *  Kept separate from ROLE_COLOR (the site's UI accent, which has to stay
 *  recognisable) so the glow can be desaturated without weakening the accent
 *  the rest of the card uses. */
export const MOOD: Record<PerkRole, { rgb: string }> = {
  survivor: { rgb: "88,178,226" },
  killer: { rgb: "226,104,96" },
};

export const ROLE_LABEL: Record<PerkRole, { ru: string; en: string }> = {
  survivor: { ru: "Выживший", en: "Survivor" },
  killer: { ru: "Убийца", en: "Killer" },
};

export const CANVAS_SIZE: Record<ShareCardLayout, { width: number; height: number }> =
  {
    landscape: { width: 1600, height: 900 },
    story: { width: 1080, height: 1920 },
  };

/** Icons are scraped and stored at a native 256x256 (scripts/scrape-perks.ts).
 *  Nothing here may exceed it — past that a fixed-detail bitmap just goes
 *  soft, and no html2canvas `scale` can add detail the file does not have. */
export const NATIVE_ICON = 256;

/** Tiled, seeded noise (public/export-grain.png). A real image because SVG
 *  and CSS filters both fail under html2canvas; seeded so two exports of the
 *  same build come out byte-identical. */
export const GRAIN = "/export-grain.png";

/** Inner padding of the anchored (portrait-composition) band. Named because
 *  the band's own width is derived from them plus its contents. */
export const BAND_PAD_L = 46;
export const BAND_PAD_R = 28;
