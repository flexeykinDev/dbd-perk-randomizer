"use client";

import { withBasePath } from "@/lib/asset-path";
import { ROLE_COLOR } from "@/lib/role-color";
import { useThemeTokens } from "@/lib/theme-tokens";
import type { ObsFrame } from "@/lib/use-obs-mode";
import type { PerkRole } from "@/lib/types";

/* How a single card is framed on the overlay.
 *
 * Independent of the background: fog behind plain icons is a good look, and so
 * is a reel well on an otherwise transparent scene. "plain" is the default and
 * renders nothing at all, so an overlay already in somebody's scene is
 * untouched by this existing.
 *
 * Both framings are the CSS reading of what their canvas stage actually draws,
 * taken from the drawing code rather than from memory:
 *
 *   Ritual  a rounded card at radius 9% of its width, filled with the site's
 *           own surface, hairlined in the role accent at 55% and dropped on a
 *           soft shadow — ritual-stage.tsx's drawCard.
 *   Slots   a well that reads as depth: darker at the lips than in the middle
 *           on a dark theme and the reverse on a light one, so the shading is
 *           shadow either way rather than a black tube dropped into white —
 *           slots-stage.tsx's reel gradient, with its 14px corner.
 */
export function ObsCardFrame({
  frame,
  role,
  /** The icon size the unframed overlay would have used. The frame is
   *  proportioned around it and then sizes the art ITSELF — a frame that took
   *  a pre-sized image could only ever pad it, and perk art carries enough
   *  transparent margin that padding it leaves a card visibly half empty. */
  size,
  src,
  alt,
}: {
  frame: ObsFrame;
  role: PerkRole;
  size: number;
  src: string;
  alt: string;
}) {
  const theme = useThemeTokens();
  const accent = ROLE_COLOR[role].solid;



  if (frame === "ritual") {
    const w = Math.round(size * 1.14);
    return (
      <div
        className="flex items-center justify-center"
        style={{
          width: w,
          /* Not the stage's 1.4. A dealt card is that tall because it carries
             the perk NAME inside it; on the overlay the name is a pill below
             the card, so the same ratio just leaves an empty lower half. Kept
             portrait, because a square would stop reading as a card. */
          height: Math.round(w * 1.16),
          borderRadius: Math.round(w * 0.09),
          background: theme.surface,
          border: `1px solid ${accent}8c`,
          boxShadow: "0 8px 22px -6px rgba(0,0,0,0.6)",
        }}
      >
        <Art src={src} alt={alt} size={Math.round(w * 0.88)} />
      </div>
    );
  }

  // Slots.
  const w = Math.round(size * 1.12);
  return (
    <div
      className="flex items-center justify-center"
      style={{
        width: w,
        /* A well is taller than it is wide — that is what makes it a well
           rather than a tile — but not the stage's 1.5, which is sized to show
           symbols scrolling past above and below the pay line. Nothing scrolls
           here; one symbol has landed. */
        height: Math.round(w * 1.28),
        borderRadius: 14,
        background: `linear-gradient(180deg, ${theme.stageGround} 0%, ${theme.surface} 50%, ${theme.stageGround} 100%)`,
        border: `1px solid ${accent}aa`,
        // The lip. A well without one reads as a printed rectangle rather
        // than a recess.
        boxShadow: "inset 0 10px 18px -10px rgba(0,0,0,0.85), inset 0 -10px 18px -10px rgba(0,0,0,0.85)",
      }}
    >
      {/* 0.84, the same share of the well the stage gives a landed symbol. */}
      <Art src={src} alt={alt} size={Math.round(w * 0.84)} />
    </div>
  );
}

function Art({ src, alt, size }: { src: string; alt: string; size: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- the overlay renders outside the app shell
    <img
      src={withBasePath(src)}
      alt={alt}
      width={size}
      height={size}
      style={{ width: size, height: size, objectFit: "contain" }}
      className="icon-art"
    />
  );
}
