"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { entranceMotion } from "@/lib/obs-entrance";
import { withBasePath } from "@/lib/asset-path";
import { getCharacterName } from "@/lib/character-name";
import { cn } from "@/lib/cn";
import {
  loadLastObsState,
  subscribeObsState,
  type ObsPerk,
  type ObsSyncPayload,
} from "@/lib/obs-sync";
import { getCharacterPortrait } from "@/lib/perks";
import { ROLE_COLOR } from "@/lib/role-color";
import { useObsOverlayOptions, useObsRoomCode } from "@/lib/use-obs-mode";
import { useT, type Lang } from "@/lib/i18n";

// Base pixel sizes at scale=100 ("normal") — every other scale value just
// multiplies these, which is what lets scale be a continuous slider instead
// of a fixed sm/md/lg set.
const BASE_ICON_PX = 84;
const BASE_GAP_PX = 16;
// Extra gap between the perk block and the loadout block when both are on
// screen at once ("all" mode) — visually separates the two groups instead
// of 8 pieces reading as one long undifferentiated bar. Only applies to the
// default centered layout; dragged/custom positions are the user's own
// layout and aren't touched.
const GROUP_GAP_PX = 40;
const BASE_NAME_FONT_PX = 12;
const BASE_NAME_PAD_X_PX = 12;
const BASE_NAME_PAD_Y_PX = 4;
// Generous enough that most perk names fit without an ellipsis at the
// default scale — long RU names (e.g. "Стиснув зубы", "Порча: шут судьбы")
// were getting cut off after just a few letters at the old 128px cap. The
// `nameScale` URL param (see the modal's "Ширина имени" slider) multiplies
// this further for names that still don't fit.
const BASE_NAME_MAX_WIDTH_PX = 200;

type PieceKind = "perk" | "item" | "addon" | "offering";

// Loadout pieces are published with their slug prefixed "kind:slug" (see
// randomizer-board.tsx's publish effect) specifically so they can't collide
// as React keys with a perk on the same list — that prefix doubles as the
// only signal this component has for which kind of piece it's looking at,
// so it's reused here rather than widening the sync payload just for this.
function pieceKind(slug: string): PieceKind {
  const prefix = slug.split(":")[0];
  return prefix === "item" || prefix === "addon" || prefix === "offering"
    ? prefix
    : "perk";
}

// Visual hierarchy within a loadout group: the Item (or a killer's Power)
// reads as the "main" piece and gets a small bump, Add-ons are secondary
// and get a small reduction, Offerings and perks stay at the base size.
const KIND_SCALE: Record<PieceKind, number> = {
  perk: 1,
  item: 1.15,
  addon: 0.82,
  offering: 1,
};

const BASE_BADGE_PORTRAIT_PX = 48;
const BASE_BADGE_FONT_PX = 13;

/** A small "who this build belongs to" badge — pinned to a fixed screen
 *  corner (not part of the perk/loadout row layout, so it doesn't compete
 *  with slot positions or the "all" mode row grouping above). Same soft
 *  card treatment as renderCard's pieces: translucent background, thin
 *  border, faint role-color ring. */
function CharacterBadge({
  slug,
  language,
  scaleRatio,
  roleColor,
  position,
}: {
  slug: string;
  language: Lang;
  scaleRatio: number;
  roleColor: { solid: string };
  /** Dragged position from the modal preview, or `null` for the original
   *  fixed bottom-left corner — same "no override yet" convention
   *  `positions` uses for the perk/loadout slots. */
  position: { x: number; y: number } | null;
}) {
  const portrait = getCharacterPortrait(slug);
  if (!portrait) return null;
  const portraitSize = Math.round(BASE_BADGE_PORTRAIT_PX * scaleRatio);

  return (
    <div
      className={cn(
        "z-10 flex items-center gap-2",
        position
          ? "absolute -translate-x-1/2 -translate-y-1/2"
          : "absolute bottom-4 left-4",
      )}
      style={
        position ? { left: `${position.x}%`, top: `${position.y}%` } : undefined
      }
    >
      <span
        className="flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-white/10 bg-black/55 backdrop-blur-sm"
        style={{
          width: portraitSize,
          height: portraitSize,
          boxShadow: `0 0 0 1px ${roleColor.solid}26, 0 6px 16px -4px rgba(0,0,0,0.5)`,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- overlay renders outside the normal app shell; next/image's basePath handling isn't relevant here either way */}
        <img
          src={withBasePath(portrait)}
          alt={getCharacterName(slug, language)}
          width={portraitSize}
          height={portraitSize}
          style={{
            width: portraitSize,
            height: portraitSize,
            objectFit: "cover",
          }}
        />
      </span>
      <span
        className="rounded-lg bg-black/55 font-bold text-white backdrop-blur-sm"
        style={{
          fontSize: Math.round(BASE_BADGE_FONT_PX * scaleRatio),
          padding: `${Math.round(4 * scaleRatio)}px ${Math.round(10 * scaleRatio)}px`,
          boxShadow: "0 4px 10px -2px rgba(0,0,0,0.4)",
        }}
      >
        {getCharacterName(slug, language)}
      </span>
    </div>
  );
}

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
  const gapPx = Math.round(BASE_GAP_PX * scaleRatio);
  const usePositions =
    !!options.positions &&
    !!state &&
    options.positions.length >= state.perks.length;

  // Split into "perks" vs "everything from the loadout" purely to group
  // them visually in the default (non-dragged) layout — a build that's
  // perks-only or loadout-only ends up with one empty group and renders
  // exactly as a single row, same as before this existed.
  const perkPieces =
    state?.perks.filter((p) => pieceKind(p.slug) === "perk") ?? [];
  const loadoutPieces =
    state?.perks.filter((p) => pieceKind(p.slug) !== "perk") ?? [];
  const hasBothGroups = perkPieces.length > 0 && loadoutPieces.length > 0;

  function renderCard(
    perk: ObsPerk,
    index: number,
    pos: { x: number; y: number } | null,
  ) {
    const iconSize = Math.round(
      BASE_ICON_PX * scaleRatio * KIND_SCALE[pieceKind(perk.slug)],
    );
    return (
      <motion.div
        key={perk.slug}
        {...entranceMotion(options.entrance, index)}
        className={cn(
          "flex flex-col items-center gap-1.5",
          pos && "absolute -translate-x-1/2 -translate-y-1/2",
        )}
        style={{
          ...(pos ? { left: `${pos.x}%`, top: `${pos.y}%` } : {}),
          // Without this the "flip" entrance rotates in an orthographic
          // projection, which looks like the card is being squashed
          // horizontally rather than turned over.
          ...(options.entrance === "flip" ? { perspective: 700 } : {}),
        }}
      >
        <span
          // Soft, low-contrast card instead of a bright neon-style ring —
          // a thin translucent border plus a subtle drop shadow for depth,
          // with just a whisper of the role color as a ~15%-opacity outer
          // ring (the first boxShadow layer below) rather than a solid,
          // fully-opaque 3px stroke.
          className="flex items-center justify-center rounded-2xl border border-white/10 bg-black/55 p-1.5 backdrop-blur-sm"
          style={{
            boxShadow: `0 0 0 1px ${roleColor?.solid}26, 0 6px 16px -4px rgba(0,0,0,0.5)`,
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- overlay renders outside the normal app shell; next/image's basePath handling isn't relevant here either way */}
          <img
            src={withBasePath(perk.icon)}
            alt={perk.name[state!.language]}
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
            className="line-clamp-2 inline-block rounded-lg bg-black/55 text-center leading-tight font-bold break-words text-white backdrop-blur-sm"
            style={{
              fontSize: Math.round(BASE_NAME_FONT_PX * scaleRatio),
              paddingLeft: Math.round(BASE_NAME_PAD_X_PX * scaleRatio),
              paddingRight: Math.round(BASE_NAME_PAD_X_PX * scaleRatio),
              paddingTop: Math.round(BASE_NAME_PAD_Y_PX * scaleRatio),
              paddingBottom: Math.round(BASE_NAME_PAD_Y_PX * scaleRatio),
              maxWidth: Math.round(
                BASE_NAME_MAX_WIDTH_PX * scaleRatio * nameScaleRatio,
              ),
              boxShadow: "0 4px 10px -2px rgba(0,0,0,0.4)",
            }}
          >
            {perk.name[state!.language]}
          </span>
        )}
      </motion.div>
    );
  }

  return (
    <div
      className={cn(
        // obs-overlay-root: stays visible despite living inside the
        // .app-shell wrapper that data-obs-pending hides pre-hydration
        // (see globals.css) — visibility, unlike display:none, lets a
        // descendant opt back in even while an ancestor is hidden.
        "obs-overlay-root fixed inset-0 overflow-hidden p-4",
        usePositions ? "" : "flex flex-col items-center justify-center",
      )}
      style={
        usePositions
          ? undefined
          : { gap: hasBothGroups ? Math.round(GROUP_GAP_PX * scaleRatio) : 0 }
      }
    >
      {state?.character && options.showCharacter && roleColor && (
        <CharacterBadge
          slug={state.character}
          language={state.language}
          scaleRatio={options.characterScale / 100}
          roleColor={roleColor}
          position={options.characterPosition}
        />
      )}
      {!state || state.perks.length === 0 ? (
        <p className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-lg bg-black/60 px-3 py-1.5 text-xs whitespace-nowrap text-white/70">
          {t({
            ru: "Ждём билд с основного сайта…",
            en: "Waiting for a build from the main site…",
          })}
        </p>
      ) : usePositions ? (
        <AnimatePresence mode="popLayout">
          {state.perks.map((perk, index) =>
            renderCard(perk, index, options.positions![index]),
          )}
        </AnimatePresence>
      ) : (
        // Two stacked rows (perks on top, loadout below) instead of one
        // long horizontal bar once both groups are present — 8 pieces in a
        // single row was the "stretched, bulky" look this replaces. A
        // perks-only or loadout-only build never has a second group, so it
        // still renders as the single centered row it always did.
        <>
          {perkPieces.length > 0 && (
            <div
              className="flex items-center justify-center"
              style={{ gap: gapPx }}
            >
              <AnimatePresence mode="popLayout">
                {perkPieces.map((perk, index) => renderCard(perk, index, null))}
              </AnimatePresence>
            </div>
          )}
          {loadoutPieces.length > 0 && (
            <div
              className="flex items-center justify-center"
              style={{ gap: gapPx }}
            >
              <AnimatePresence mode="popLayout">
                {loadoutPieces.map((perk, index) =>
                  renderCard(perk, perkPieces.length + index, null),
                )}
              </AnimatePresence>
            </div>
          )}
        </>
      )}
    </div>
  );
}
