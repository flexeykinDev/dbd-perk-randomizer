"use client";

import { withBasePath } from "@/lib/asset-path";
import { ObsReel, reelTiming } from "./obs-reel";
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
  index,
  spin,
}: {
  frame: ObsFrame;
  role: PerkRole;
  size: number;
  src: string;
  alt: string;
  /** Position in the row — the reels' left-to-right settle depends on it. */
  index: number;
  /** False when the streamer has asked for no motion at all. */
  spin: boolean;
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

  /* Slots is a real reel — a strip with the result on the pay line and the
     symbols either side of it — rather than one icon in a box. See
     obs-reel.tsx for why that distinction is the whole feature. */
  return (
    <ObsReel
      role={role}
      size={size}
      src={src}
      alt={alt}
      index={index}
      timing={reelTiming(index)}
      animate={spin}
    />
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
