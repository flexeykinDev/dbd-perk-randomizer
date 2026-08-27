"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import { withBasePath } from "@/lib/asset-path";
import { getPerksByRole } from "@/lib/perks";
import { ROLE_COLOR } from "@/lib/role-color";
import { useThemeTokens } from "@/lib/theme-tokens";
import type { PerkRole } from "@/lib/types";

/* A real slot reel, not a picture of one.
 *
 * The first version of the Slots frame was a single icon in a well, which is
 * the shape of a reel with none of the point: a reel shows a STRIP — the
 * symbol that landed on the pay line, and the ones either side of it, dimmer
 * at the lips. That is what makes it read as a machine that stopped rather
 * than a box with a picture in it.
 *
 * This is slots-stage.tsx's rendering in DOM rather than canvas. DOM because
 * the overlay only animates when a build arrives: a canvas would mean a
 * permanent rAF loop inside OBS for something that is still 99% of the time,
 * whereas a transform animation costs nothing once it has settled.
 */

/** Visible cells. Three is the whole grammar of a reel — one above, the
 *  result, one below. */
const VISIBLE = 3;

/** How many cells scroll past before the result lands. Enough to read as a
 *  spin; not so many that the strip is a hundred image requests. */
const RUN_UP = 7;

export interface ReelTiming {
  /** Seconds before this reel starts easing to its stop. Reels settle left to
   *  right, and the last one landing is what makes it a result. */
  delay: number;
  duration: number;
}

export function ObsReel({
  role,
  size,
  src,
  alt,
  index,
  timing,
  animate,
}: {
  role: PerkRole;
  /** The icon size the unframed overlay would have used; the well is
   *  proportioned around it. */
  size: number;
  src: string;
  alt: string;
  /** Which reel this is, for the stagger and for varying the strip. */
  index: number;
  timing: ReelTiming;
  /** False for reduce-motion, where the result is simply already on the pay
   *  line. */
  animate: boolean;
}) {
  const theme = useThemeTokens();
  const accent = ROLE_COLOR[role].solid;

  const cell = Math.round(size * 1.02);
  const wellW = Math.round(size * 1.24);
  const wellH = cell * VISIBLE;

  /* The symbols that scroll past on the way down. Drawn from the role's own
     pool, so a reel shows plausible perks rather than the same four repeating
     — the pool is already in this bundle for the character portraits.
     Deterministic per reel and per result: a re-render must not reshuffle the
     strip mid-spin, which would read as the reel changing its mind. */
  const strip = useMemo(() => {
    const pool = getPerksByRole(role);
    if (pool.length === 0) return [src];
    let seed = 0;
    for (const ch of `${src}:${index}`) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
    const pick = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return pool[seed % pool.length].icon;
    };
    // …run-up symbols, the result, then one more so the pay line is not the
    // last thing on the strip and the cell below it is filled.
    return [...Array.from({ length: RUN_UP }, pick), src, pick()];
  }, [role, src, index]);

  const resultIndex = strip.length - 2;
  /** Where the strip must sit for cell `k` to be centred in the well. */
  const offsetFor = (k: number) => (1 - k) * cell;

  return (
    <div
      className="relative overflow-hidden"
      style={{
        width: wellW,
        height: wellH,
        borderRadius: 14,
        // Depth: darker at the lips than in the middle on a dark theme, and
        // the reverse on a light one, so the shading reads as shadow either
        // way rather than a black tube dropped into white.
        background: `linear-gradient(180deg, ${theme.stageGround} 0%, ${theme.surface} 50%, ${theme.stageGround} 100%)`,
        border: `1px solid ${accent}aa`,
      }}
    >
      <motion.div
        initial={animate ? { y: offsetFor(0) } : false}
        animate={{ y: offsetFor(resultIndex) }}
        transition={
          animate
            ? {
                duration: timing.duration,
                delay: timing.delay,
                // easeOutQuint. A reel brakes hard and then arrives; it does
                // not bounce, and a spring here would put a visible kick on
                // the end of every spin.
                ease: [0.22, 1, 0.36, 1],
              }
            : { duration: 0 }
        }
        style={{ position: "absolute", left: 0, right: 0, top: 0 }}
      >
        {strip.map((icon, i) => (
          <div
            key={`${icon}-${i}`}
            className="flex items-center justify-center"
            style={{ height: cell }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- the overlay renders outside the app shell */}
            <img
              src={withBasePath(icon)}
              alt={i === resultIndex ? alt : ""}
              width={Math.round(cell * 0.82)}
              height={Math.round(cell * 0.82)}
              style={{
                width: Math.round(cell * 0.82),
                height: Math.round(cell * 0.82),
                objectFit: "contain",
              }}
              className="icon-art"
            />
          </div>
        ))}
      </motion.div>

      {/* Shades the lips. The stage fades each symbol by its distance from the
          pay line, which needs a value per symbol per frame; one gradient over
          the whole well reads the same and costs nothing while the reel is
          still. */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: `linear-gradient(180deg, ${theme.stageGround} 0%, rgba(0,0,0,0) 34%, rgba(0,0,0,0) 66%, ${theme.stageGround} 100%)`,
          opacity: 0.86,
        }}
      />

      {/* The pay line. Per reel rather than one line across the row, because
          the slots can be dragged anywhere in the overlay — a row-spanning
          line would be a lie the moment somebody moves one. In the default
          row the wells sit close enough that it still reads as continuous. */}
      <div
        className="pointer-events-none absolute inset-x-0"
        style={{
          top: "50%",
          height: 1,
          background: `linear-gradient(90deg, transparent, ${accent}, transparent)`,
          opacity: 0.55,
        }}
      />
    </div>
  );
}

/** Reels settle left to right. Halved from the stage's 320ms: there the pull
 *  IS the show, here it is a notification that has to be out of the way
 *  again. */
export function reelTiming(index: number): ReelTiming {
  return { delay: index * 0.14, duration: 0.95 };
}
