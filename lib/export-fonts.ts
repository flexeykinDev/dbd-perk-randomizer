// Typefaces for the exported share card.
//
// These are loaded the same way the site's own Geist is (next/font/google —
// downloaded at build time and self-hosted), which matters more here than
// anywhere else on the site: the export runs through html2canvas, which draws
// text with canvas `fillText` using the element's *computed* font-family. A
// webfont that has not finished loading does not fall back gracefully in the
// export — it silently bakes the fallback face into the PNG. Self-hosting
// removes the network from that race, and components/dbd/randomizer-board.tsx
// additionally awaits `document.fonts.ready` before rasterising.
//
// Both families carry the cyrillic subset because every string on the card is
// Russian by default.
//
// `.style.fontFamily` is what share-card.tsx consumes: a literal family
// string, never a CSS custom property. The share card cannot use `var(...)`
// (see the header comment in share-card.tsx for why it avoids anything
// html2canvas has to resolve).
import { IBM_Plex_Mono, Oswald } from "next/font/google";

/** Display face: condensed grotesque for names, headings and perk labels. */
export const oswald = Oswald({
  subsets: ["latin", "cyrillic"],
  variable: "--font-oswald",
});

/** Label face: small wide-tracked uppercase, and the footer. */
export const plexMono = IBM_Plex_Mono({
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500"],
  variable: "--font-plex-mono",
});
