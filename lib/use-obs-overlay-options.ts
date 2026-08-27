"use client";

// Everything the OBS Overlay modal lets a streamer tune about how the
// overlay looks, extracted from the modal so the modal is a layout again
// rather than a component with two dozen useState calls in its preamble.
//
// This is settings state in the same sense as use-twitch-settings.ts: a
// pile of independent values that are only related in that they all end up
// encoded into one link. Keeping them here means the pieces that *render*
// them (the preview canvas, the appearance panel) can each take the few
// they actually use instead of reaching into one giant closure.
//
// The drag maths lives here too, not in the preview component, because it
// only makes sense in terms of these values — a drag is a write to
// `positions`, and the element it came from is incidental.
import { useId, useRef, useState } from "react";
import type { ObsLayoutSnapshot } from "./obs-layouts";
import {
  DEFAULT_OBS_OPTIONS,
  MAX_CHARACTER_SCALE,
  MIN_CHARACTER_SCALE,
  obsOverlayUrl,
  type ObsBackground,
  type ObsEntrance,
  type ObsFrame,
  type ObsIconPosition,
  type ObsMotion,
} from "./use-obs-mode";

// 8 slots: 4 perks + 4 loadout pieces, the largest "all" mode can produce.
// Two rows of four, separated by 45 percentage points. The gap is worth a
// word: with names on, each slot is an icon *and* a 2-line label
// underneath, so a tighter separation let row 1's labels overlap row 2's
// icons at the preview's size.
const DEFAULT_SLOT_POSITIONS: readonly ObsIconPosition[] = [
  { x: 12.5, y: 33 },
  { x: 37.5, y: 33 },
  { x: 62.5, y: 33 },
  { x: 87.5, y: 33 },
  { x: 12.5, y: 78 },
  { x: 37.5, y: 78 },
  { x: 62.5, y: 78 },
  { x: 87.5, y: 78 },
];

/** Bottom-left, inset from the edge — mirrors obs-overlay.tsx's own
 *  pre-drag fallback (a fixed `bottom-4 left-4` corner) in the same 0-100
 *  percentage space, so an untouched character badge starts roughly where
 *  the real overlay would put it. */
export const DEFAULT_CHARACTER_POSITION: ObsIconPosition = { x: 8, y: 90 };

export const MIN_CANVAS_WIDTH = 320;
export const MAX_CANVAS_WIDTH = 1920;
export const MIN_CANVAS_HEIGHT = 120;
export const MAX_CANVAS_HEIGHT = 800;

export type StyleId = "compact" | "standard" | "roomy" | "custom";

export interface StylePreset {
  id: Exclude<StyleId, "custom">;
  label: { ru: string; en: string };
  description: { ru: string; en: string };
  canvasWidth: number;
  canvasHeight: number;
  scale: number;
  nameScale: number;
}

// Canvas size, icon scale, and name width used to be 3 independent dials —
// easy to land on a combination that looks bad (e.g. a small canvas with a
// wide name box, or a big canvas with tiny icons floating in empty space).
// These 3 presets are each a tested, coherent look; "Roomy" is what testing
// showed actually looks good in a real OBS scene, so it's also the default
// here and in DEFAULT_OBS_OPTIONS (lib/use-obs-mode.ts).
export const STYLE_PRESETS: readonly StylePreset[] = [
  {
    id: "compact",
    label: { ru: "Компакт", en: "Compact" },
    description: {
      ru: "Минимум места — для тесных сцен",
      en: "Minimal footprint — for tight scenes",
    },
    canvasWidth: 800,
    canvasHeight: 220,
    scale: 90,
    nameScale: 110,
  },
  {
    id: "standard",
    label: { ru: "Стандарт", en: "Standard" },
    description: {
      ru: "Сбалансированный размер для большинства сцен",
      en: "Balanced size for most scenes",
    },
    canvasWidth: 900,
    canvasHeight: 300,
    scale: 115,
    nameScale: 145,
  },
  {
    id: "roomy",
    label: { ru: "Просторно", en: "Roomy" },
    description: {
      ru: "Крупные карточки, имена никогда не жмутся",
      en: "Large cards, names never cramped",
    },
    canvasWidth: 1100,
    canvasHeight: 420,
    scale: 135,
    nameScale: 170,
  },
];

const DEFAULT_STYLE = STYLE_PRESETS.find((p) => p.id === "roomy")!;

const PREVIEW_BASE_ICON_PX = 34;
const PREVIEW_BASE_NAME_MAX_WIDTH_PX = 56;
const PREVIEW_BASE_CHARACTER_PX = 28;
/** A floor under the aspect-ratio-derived height — a wide/short preset
 *  (e.g. "Roomy" at ~2.6:1) renders the preview box too short for two rows
 *  of icon+label to fit without overlapping. aspect-ratio still wins
 *  whenever it would make the box taller; this is only a minimum. */
export const PREVIEW_MIN_HEIGHT_PX = 260;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

/**
 * @param open Whether the modal is showing. The overlay URL is only built
 *   while open, because obsOverlayUrl() mints a room code as a side effect
 *   (see getOrCreateRoomCode) and this component stays mounted while
 *   hidden — computing it unconditionally would overwrite a room code on
 *   every visit to the site rather than when someone opens the modal.
 */
export function useObsOverlayOptions(open: boolean) {
  const [styleMode, setStyleMode] = useState<StyleId>("roomy");
  const [scale, setScale] = useState(DEFAULT_OBS_OPTIONS.scale);
  const [nameScale, setNameScale] = useState(DEFAULT_OBS_OPTIONS.nameScale);
  const [canvasWidth, setCanvasWidth] = useState(DEFAULT_STYLE.canvasWidth);
  const [canvasHeight, setCanvasHeight] = useState(DEFAULT_STYLE.canvasHeight);
  const [showNames, setShowNames] = useState(DEFAULT_OBS_OPTIONS.showNames);
  const [showCharacter, setShowCharacter] = useState(DEFAULT_OBS_OPTIONS.showCharacter);
  const [background, setBackground] = useState<ObsBackground>(DEFAULT_OBS_OPTIONS.background);
  const [frame, setFrame] = useState<ObsFrame>(DEFAULT_OBS_OPTIONS.frame);
  const [motion, setMotion] = useState<ObsMotion>(DEFAULT_OBS_OPTIONS.motion);
  // null = no custom layout yet; the overlay falls back to its default
  // centered row. Set the first time any icon is dragged in the preview.
  const [positions, setPositions] = useState<ObsIconPosition[] | null>(null);
  // Same "no override yet" convention, but the character badge isn't one
  // of the numbered slots (see obs-overlay.tsx's CharacterBadge), so it
  // carries its own position and its own size — set by scrolling over it
  // rather than by the shared "Card size" slider.
  const [characterPosition, setCharacterPosition] = useState<ObsIconPosition | null>(null);
  const [characterScale, setCharacterScale] = useState(DEFAULT_OBS_OPTIONS.characterScale);
  // How a new build enters the scene — see lib/obs-entrance.ts.
  const [entrance, setEntrance] = useState<ObsEntrance>(DEFAULT_OBS_OPTIONS.entrance);

  // A callback ref rather than an exposed RefObject: the preview canvas
  // only ever needs to *hand over* its element, and passing a ref object
  // through this hook's return value would mean the component reads
  // `options.previewRef` during render, which is what react-hooks/refs
  // (rightly) objects to. The element itself never leaves this module.
  const previewEl = useRef<HTMLDivElement | null>(null);
  const canvasWidthId = useId();
  const cardSizeSliderId = useId();
  const nameWidthSliderId = useId();

  const url = open
    ? obsOverlayUrl({
        scale,
        nameScale,
        showNames,
        showCharacter,
        background,
        frame,
        motion,
        positions: positions ?? undefined,
        characterPosition: characterPosition ?? undefined,
        characterScale,
        entrance,
      })
    : "";

  /** Turns a pointer position into the same 0-100 coordinate space the
   *  overlay uses for `positions` / `characterPosition`. */
  function clientToPercent(clientX: number, clientY: number): ObsIconPosition {
    const rect = previewEl.current?.getBoundingClientRect();
    if (!rect) return { x: 50, y: 50 };
    return {
      x: clamp(((clientX - rect.left) / rect.width) * 100, 0, 100),
      y: clamp(((clientY - rect.top) / rect.height) * 100, 0, 100),
    };
  }

  return {
    styleMode,
    entrance,
    setEntrance,
    scale,
    nameScale,
    canvasWidth,
    canvasHeight,
    showNames,
    showCharacter,
    background,
    frame,
    motion,
    positions,
    characterPosition,
    characterScale,
    url,
    /** Attach to the preview canvas element — see previewEl above. */
    attachPreview: (el: HTMLDivElement | null) => {
      previewEl.current = el;
    },
    canvasWidthId,
    cardSizeSliderId,
    nameWidthSliderId,

    setScale,
    setNameScale,
    toggleShowNames: () => setShowNames((v) => !v),
    setBackground,
    setFrame,
    setMotion,
    toggleShowCharacter: () => setShowCharacter((v) => !v),
    useCustomStyle: () => setStyleMode("custom"),

    /** Pixel sizes the preview draws at, derived from the same percentages
     *  the real overlay uses so the two stay proportional. */
    iconPx: Math.round(PREVIEW_BASE_ICON_PX * (scale / 100)),
    characterPx: Math.round(PREVIEW_BASE_CHARACTER_PX * (characterScale / 100)),
    nameMaxWidthPx: Math.round(PREVIEW_BASE_NAME_MAX_WIDTH_PX * (nameScale / 100)),

    slotPositionAt: (index: number) =>
      (positions ?? DEFAULT_SLOT_POSITIONS)[index] ?? DEFAULT_SLOT_POSITIONS[index],
    characterPositionOrDefault: characterPosition ?? DEFAULT_CHARACTER_POSITION,

    dragSlot(index: number, clientX: number, clientY: number) {
      const pos = clientToPercent(clientX, clientY);
      setPositions((prev) => {
        const base = prev ? [...prev] : [...DEFAULT_SLOT_POSITIONS];
        base[index] = pos;
        return base;
      });
    },
    dragCharacter(clientX: number, clientY: number) {
      setCharacterPosition(clientToPercent(clientX, clientY));
    },
    // Scroll-to-resize rather than a slider: the badge is a single
    // free-floating element, so adjusting it in place reads more directly
    // than hunting for a control elsewhere in the modal for just this one
    // piece.
    resizeCharacter(deltaY: number) {
      setCharacterScale((prev) =>
        clamp(Math.round(prev - deltaY / 4), MIN_CHARACTER_SCALE, MAX_CHARACTER_SCALE),
      );
    },
    resetLayout() {
      setPositions(null);
      setCharacterPosition(null);
      setCharacterScale(DEFAULT_OBS_OPTIONS.characterScale);
    },

    updateCanvasWidth(width: number) {
      if (!Number.isFinite(width)) return;
      setCanvasWidth(clamp(Math.round(width), MIN_CANVAS_WIDTH, MAX_CANVAS_WIDTH));
    },
    updateCanvasHeight(height: number) {
      if (!Number.isFinite(height)) return;
      setCanvasHeight(clamp(Math.round(height), MIN_CANVAS_HEIGHT, MAX_CANVAS_HEIGHT));
    },
    applyStylePreset(preset: StylePreset) {
      setStyleMode(preset.id);
      setCanvasWidth(preset.canvasWidth);
      setCanvasHeight(preset.canvasHeight);
      setScale(preset.scale);
      setNameScale(preset.nameScale);
    },
    activePresetDescription:
      styleMode === "custom"
        ? {
            ru: "Точная настройка холста, размера и ширины имени.",
            en: "Fine control over canvas, size, and name width.",
          }
        : STYLE_PRESETS.find((p) => p.id === styleMode)?.description,

    /** Everything that makes the overlay look the way it looks, flat, for
     *  saving as a named layout (see lib/obs-layouts.ts). */
    snapshot: (): ObsLayoutSnapshot => ({
      scale,
      nameScale,
      canvasWidth,
      canvasHeight,
      showNames,
      showCharacter,
      // darkBg is still written for layouts read by an older build, and is
      // what `skin` falls back to when an older layout is read by this one.
      darkBg: background === "dark",
      skin: background,
      frame,
      motion,
      characterScale,
      positions,
      characterPosition,
    }),

    applySnapshot(snapshot: ObsLayoutSnapshot) {
      setScale(snapshot.scale);
      setNameScale(snapshot.nameScale);
      setCanvasWidth(snapshot.canvasWidth);
      setCanvasHeight(snapshot.canvasHeight);
      setShowNames(snapshot.showNames);
      setShowCharacter(snapshot.showCharacter);
      setBackground(snapshot.skin ?? (snapshot.darkBg ? "dark" : "transparent"));
      setFrame(snapshot.frame ?? DEFAULT_OBS_OPTIONS.frame);
      setMotion(snapshot.motion ?? DEFAULT_OBS_OPTIONS.motion);
      setCharacterScale(snapshot.characterScale);
      setPositions(snapshot.positions);
      setCharacterPosition(snapshot.characterPosition);
      // A saved layout is by definition a specific combination rather than
      // one of the three named looks, so the preset row shows "Custom" —
      // claiming "Roomy" while the sliders say otherwise would be a lie
      // the moment anything was nudged.
      setStyleMode("custom");
    },
  };
}

export type ObsOverlayOptions = ReturnType<typeof useObsOverlayOptions>;

/** Kept as a named export so the preview and the appearance panel can both
 *  reason about the 8-slot cap without importing the array itself. */
export const MAX_PREVIEW_SLOTS = DEFAULT_SLOT_POSITIONS.length;

/** The pieces the preview should draw, mirroring exactly what the overlay
 *  is being sent.
 *
 *  This has to filter by visibility the same way randomizer-board.tsx does
 *  before publishing, and it has to do it *here* rather than anywhere
 *  further down: positions are assigned by array index, so a modal dragging
 *  against an unfiltered 8-item list while the real overlay renders a
 *  filtered 7-item one puts every piece after a hidden one at the position
 *  dragged for a different piece. */
export interface PreviewPiece {
  slug: string;
  icon: string;
  name: { en: string; ru: string };
}

export function previewPiecesFor({
  mode,
  perks,
  loadoutPieces,
  visibility,
}: {
  mode: "perks" | "loadout" | "all";
  perks: PreviewPiece[];
  loadoutPieces: (PreviewPiece & { kind: "item" | "addon" | "offering" })[];
  visibility: Record<"perks" | "item" | "addon" | "offering", boolean>;
}): { pieces: PreviewPiece[]; slotCount: number } {
  const visiblePerks = visibility.perks ? perks : [];
  const visiblePieces = loadoutPieces.filter((p) => visibility[p.kind]);
  const pieces =
    mode === "loadout"
      ? visiblePieces
      : mode === "all"
        ? [...visiblePerks, ...visiblePieces]
        : visiblePerks;
  return {
    pieces,
    // The real overlay has no cap (see obs-overlay.tsx); this is only what
    // the drag preview can represent. 4 empty slots when nothing has been
    // rolled yet, so the canvas isn't blank.
    slotCount: pieces.length > 0 ? Math.min(pieces.length, MAX_PREVIEW_SLOTS) : 4,
  };
}
