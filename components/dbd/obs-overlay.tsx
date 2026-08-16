"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { withBasePath } from "@/lib/asset-path";
import { cn } from "@/lib/cn";
import { ROLE_COLOR } from "@/lib/role-color";
import { loadLastObsState, subscribeObsState, type ObsSyncPayload } from "@/lib/obs-sync";
import { useObsOverlayOptions, useObsRoomCode } from "@/lib/use-obs-mode";
import { useT } from "@/lib/i18n";

// Base pixel sizes at scale=100 ("normal") — every other scale value just
// multiplies these, which is what lets scale be a continuous slider instead
// of a fixed sm/md/lg set.
const BASE_ICON_PX = 84;
const BASE_GAP_PX = 16;
const BASE_NAME_FONT_PX = 12;
const BASE_NAME_PAD_X_PX = 12;
const BASE_NAME_PAD_Y_PX = 4;
// Generous enough that most perk names fit without an ellipsis at the
// default scale — long RU names (e.g. "Стиснув зубы", "Порча: шут судьбы")
// were getting cut off after just a few letters at the old 128px cap. The
// `nameScale` URL param (see the modal's "Ширина имени" slider) multiplies
// this further for names that still don't fit.
const BASE_NAME_MAX_WIDTH_PX = 200;

/** The stream overlay view (`#/obs`) — a fully transparent background (by
 *  default) showing only the current perk cards, animated in/out as the
 *  main tab regenerates. Size, name visibility, background style, and
 *  per-icon position are all customizable via URL query params — see
 *  lib/use-obs-mode.ts. See lib/obs-sync.ts for how it hears about changes
 *  from the main tab. */
export function ObsOverlay() {
  const t = useT();
  const options = useObsOverlayOptions();
  const room = useObsRoomCode();
  const [state, setState] = useState<ObsSyncPayload | null>(null);

  useEffect(() => {
    function applyLastKnownState() {
      setState(loadLastObsState());
    }
    applyLastKnownState();
    const unsubscribe = subscribeObsState(setState, room);
    return unsubscribe;
  }, [room]);

  useEffect(() => {
    // The page's own background is opaque (see globals.css) — this is the
    // one view on the site that needs to see through to OBS's canvas, unless
    // the user opted into a visible dark backdrop (?bg=dark) for previewing
    // outside OBS or for a deliberately non-transparent panel look.
    const color = options.background === "dark" ? "#0b0c0f" : "transparent";
    document.documentElement.style.backgroundColor = color;
    document.body.style.backgroundColor = color;
    return () => {
      document.documentElement.style.backgroundColor = "";
      document.body.style.backgroundColor = "";
    };
  }, [options.background]);

  const roleColor = state ? ROLE_COLOR[state.role] : null;
  const scaleRatio = options.scale / 100;
  const nameScaleRatio = options.nameScale / 100;
  const iconSize = Math.round(BASE_ICON_PX * scaleRatio);
  const gapPx = Math.round(BASE_GAP_PX * scaleRatio);
  const usePositions = !!options.positions && !!state && options.positions.length >= state.perks.length;

  return (
    <div
      className={cn(
        // obs-overlay-root: stays visible despite living inside the
        // .app-shell wrapper that data-obs-pending hides pre-hydration
        // (see globals.css) — visibility, unlike display:none, lets a
        // descendant opt back in even while an ancestor is hidden.
        "obs-overlay-root fixed inset-0 overflow-hidden p-4",
        usePositions ? "" : "flex items-center justify-center",
      )}
      style={usePositions ? undefined : { gap: gapPx }}
    >
      {!state || state.perks.length === 0 ? (
        <p className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-lg bg-black/60 px-3 py-1.5 text-xs whitespace-nowrap text-white/70">
          {t({
            ru: "Ждём билд с основного сайта…",
            en: "Waiting for a build from the main site…",
          })}
        </p>
      ) : (
        <AnimatePresence mode="popLayout">
          {state.perks.map((perk, index) => {
            const pos = usePositions ? options.positions![index] : null;
            return (
              <motion.div
                key={perk.slug}
                initial={{ opacity: 0, scale: 0.75, y: 16 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.75, y: -16 }}
                transition={{ duration: 0.35, delay: index * 0.06, ease: "easeOut" }}
                className={cn("flex flex-col items-center gap-1.5", pos && "absolute -translate-x-1/2 -translate-y-1/2")}
                style={pos ? { left: `${pos.x}%`, top: `${pos.y}%` } : undefined}
              >
                <span
                  className="flex items-center justify-center rounded-2xl border-[3px] bg-black/70 p-1.5 shadow-2xl backdrop-blur-sm"
                  style={{ borderColor: roleColor?.solid }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- overlay renders outside the normal app shell; next/image's basePath handling isn't relevant here either way */}
                  <img
                    src={withBasePath(perk.icon)}
                    alt={perk.name[state.language]}
                    width={iconSize}
                    height={iconSize}
                    // Inline width/height (not just the size class below) so this
                    // stays correct regardless of any container constraint or
                    // Tailwind Preflight's `img { max-width: 100%; height: auto }`
                    // — `scale` is chosen at runtime via a URL param, so there's
                    // no static Tailwind class to rely on as the sole source of
                    // truth the way the rest of the app's fixed-size icons do.
                    style={{ width: iconSize, height: iconSize, objectFit: "cover" }}
                    className="rounded-xl"
                  />
                </span>
                {options.showNames && (
                  <span
                    // Wraps onto up to 2 lines instead of cutting off on one —
                    // long names (RU especially) rarely fit a single-line pill
                    // at any reasonable width, so wrapping is the "just fits"
                    // default; line-clamp-2 still ellipsizes the rare name
                    // that overflows even two lines. A rectangle (not a full
                    // pill) reads better once the box has real height.
                    className="line-clamp-2 inline-block rounded-lg bg-black/70 text-center leading-tight font-bold break-words text-white shadow-lg backdrop-blur-sm"
                    style={{
                      fontSize: Math.round(BASE_NAME_FONT_PX * scaleRatio),
                      paddingLeft: Math.round(BASE_NAME_PAD_X_PX * scaleRatio),
                      paddingRight: Math.round(BASE_NAME_PAD_X_PX * scaleRatio),
                      paddingTop: Math.round(BASE_NAME_PAD_Y_PX * scaleRatio),
                      paddingBottom: Math.round(BASE_NAME_PAD_Y_PX * scaleRatio),
                      maxWidth: Math.round(BASE_NAME_MAX_WIDTH_PX * scaleRatio * nameScaleRatio),
                    }}
                  >
                    {perk.name[state.language]}
                  </span>
                )}
              </motion.div>
            );
          })}
        </AnimatePresence>
      )}
    </div>
  );
}
