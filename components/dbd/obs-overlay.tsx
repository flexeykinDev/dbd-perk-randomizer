"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { withBasePath } from "@/lib/asset-path";
import { cn } from "@/lib/cn";
import { ROLE_COLOR } from "@/lib/role-color";
import { loadLastObsState, subscribeObsState, type ObsSyncPayload } from "@/lib/obs-sync";
import { useObsOverlayOptions, type ObsCardSize } from "@/lib/use-obs-mode";
import { useT } from "@/lib/i18n";

const ICON_SIZE_PX: Record<ObsCardSize, number> = { sm: 60, md: 84, lg: 112 };
const NAME_TEXT_CLASS: Record<ObsCardSize, string> = {
  sm: "text-[10px] px-2 py-0.5",
  md: "text-xs px-3 py-1",
  lg: "text-sm px-3.5 py-1.5",
};
const GAP_CLASS: Record<ObsCardSize, string> = { sm: "gap-2", md: "gap-4", lg: "gap-5" };

/** The stream overlay view (`#/obs`) — a fully transparent background (by
 *  default) showing only the current perk cards, animated in/out as the
 *  main tab regenerates. Size, name visibility, and background style are
 *  customizable via URL query params — see lib/use-obs-mode.ts. See
 *  lib/obs-sync.ts for how it hears about changes from the main tab. */
export function ObsOverlay() {
  const t = useT();
  const options = useObsOverlayOptions();
  const [state, setState] = useState<ObsSyncPayload | null>(null);

  useEffect(() => {
    function applyLastKnownState() {
      setState(loadLastObsState());
    }
    applyLastKnownState();
    const unsubscribe = subscribeObsState(setState);
    return unsubscribe;
  }, []);

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
  const iconSize = ICON_SIZE_PX[options.size];

  return (
    <div
      className={cn(
        "fixed inset-0 flex items-center justify-center overflow-hidden p-4",
        GAP_CLASS[options.size],
      )}
    >
      {!state || state.perks.length === 0 ? (
        <p className="rounded-lg bg-black/60 px-3 py-1.5 text-xs text-white/70">
          {t({
            ru: "Ждём билд с основного сайта…",
            en: "Waiting for a build from the main site…",
          })}
        </p>
      ) : (
        <AnimatePresence mode="popLayout">
          {state.perks.map((perk, index) => (
            <motion.div
              key={perk.slug}
              initial={{ opacity: 0, scale: 0.75, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.75, y: -16 }}
              transition={{ duration: 0.35, delay: index * 0.06, ease: "easeOut" }}
              className="flex flex-col items-center gap-1.5"
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
                  // — `size` is chosen at runtime via a URL param, so there's
                  // no static Tailwind class to rely on as the sole source of
                  // truth the way the rest of the app's fixed-size icons do.
                  style={{ width: iconSize, height: iconSize, objectFit: "cover" }}
                  className="rounded-xl"
                />
              </span>
              {options.showNames && (
                <span
                  className={cn(
                    "max-w-32 truncate rounded-full bg-black/70 font-bold text-white shadow-lg backdrop-blur-sm",
                    NAME_TEXT_CLASS[options.size],
                  )}
                >
                  {perk.name[state.language]}
                </span>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
      )}
    </div>
  );
}
