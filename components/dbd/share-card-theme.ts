import type { PerkRole } from "@/lib/types";
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



/** Tiled, seeded noise (public/export-grain.png). A real image because SVG
 *  and CSS filters both fail under html2canvas; seeded so two exports of the
 *  same build come out byte-identical. */
export const GRAIN = "/export-grain.png";

// The card's fixed numbers live in share-card-metrics.ts, which has no
// dependencies so the layout arithmetic stays testable; re-exported here
// because this is where the card's constants have always been imported from.
export { BAND_PAD_L, BAND_PAD_R, CANVAS_SIZE, NATIVE_ICON } from "./share-card-metrics";
