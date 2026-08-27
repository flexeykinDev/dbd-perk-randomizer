import type { ShareCardLayout } from "@/lib/types";

/* The export card's fixed numbers, with no dependencies at all.
 *
 * Separate from share-card-theme.ts because that one imports the display
 * faces through next/font, which cannot load outside a Next build — and
 * share-card-layout.ts has to be runnable in a plain node process so its
 * arithmetic can be tested without rendering anything. Colours and faces stay
 * in the theme; only the numbers live here. */

export const CANVAS_SIZE: Record<ShareCardLayout, { width: number; height: number }> = {
  landscape: { width: 1600, height: 900 },
  story: { width: 1080, height: 1920 },
};

/** Icons are scraped and stored at a native 256x256 (scripts/scrape-perks.ts).
 *  Nothing may exceed it — past that a fixed-detail bitmap just goes soft, and
 *  no html2canvas `scale` can add detail the file does not have. */
export const NATIVE_ICON = 256;

/** Inner padding of the anchored (portrait-composition) band. Named because
 *  the band's own width is derived from them plus its contents. */
export const BAND_PAD_L = 46;
export const BAND_PAD_R = 28;
