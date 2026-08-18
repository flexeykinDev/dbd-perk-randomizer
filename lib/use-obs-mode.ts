"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import {
  getOrCreateRoomCode,
  getPublishStatus,
  subscribeToPublishStatus,
  type ObsPublishState,
  type ObsPublishStatus,
} from "./obs-sync";

// Re-exported so the OBS modal can import its status types from the same
// place it imports the hook, rather than reaching into obs-sync directly.
export type { ObsPublishState, ObsPublishStatus };

const OBS_HASH = "#/obs";

export type ObsBackground = "transparent" | "dark";

/** A custom on-screen position for one perk-icon slot, as a percentage of
 *  the overlay viewport (0-100, top-left origin) — same coordinate space
 *  the modal's drag-to-reposition preview uses, so a position dragged there
 *  maps 1:1 onto the real overlay running in OBS. */
export interface ObsIconPosition {
  x: number;
  y: number;
}

export interface ObsOverlayOptions {
  /** Icon size as a percentage of the default (100 = normal). */
  scale: number;
  /** Extra multiplier (percent) on top of `scale` for just the name-label
   *  box's max width — independent of icon size because a name can need
   *  more room to avoid getting cut off than the icon itself does. */
  nameScale: number;
  showNames: boolean;
  /** Whether to show the build's character portrait badge (see
   *  ObsSyncPayload.character) when one is known. Independent of
   *  `showNames` — a streamer might want the "who this is" badge without
   *  per-card name pills, or vice versa. */
  showCharacter: boolean;
  background: ObsBackground;
  /** Per-slot custom positions, indexed the same as the current build's
   *  perk list. `null` means "no override — use the default centered row
   *  layout," which is also what a fresh install and a `pos`-less URL get. */
  positions: ObsIconPosition[] | null;
  /** Where the character badge sits, dragged independently of the perk/
   *  loadout slots above (it isn't part of that list at all — see
   *  ObsSyncPayload.character). `null` falls back to the fixed
   *  bottom-left corner obs-overlay.tsx has always used. */
  characterPosition: ObsIconPosition | null;
  /** Character badge size as a percentage of its default, independent of
   *  `scale` — set via scroll-wheel while hovering it in the modal
   *  preview, same as dragging sets `characterPosition`. */
  characterScale: number;
}

// Matches the "Roomy" style preset (see obs-overlay-modal.tsx) — testing
// showed the old 100/100 default looked cramped in actual OBS scenes, so
// the good-looking combo is now what a fresh link renders with no query
// params at all, not something you have to discover by tuning sliders.
export const DEFAULT_OBS_OPTIONS: ObsOverlayOptions = {
  scale: 135,
  nameScale: 170,
  // Off by default — a full row of name pills (especially with 8 pieces in
  // "all" mode) reads as clutter on top of stream footage; the "Show card
  // names" toggle in the modal turns them back on for anyone who wants
  // them. See components/dbd/obs-overlay.tsx for the rest of the "less
  // bulky" pass this default is part of.
  showNames: false,
  // On by default — a killer's Power/character badge is useful context at
  // a glance and doesn't add nearly the visual weight a full row of name
  // pills does, so unlike showNames this defaults on.
  showCharacter: true,
  background: "transparent",
  positions: null,
  characterPosition: null,
  characterScale: 100,
};

export const MIN_OBS_SCALE = 50;
export const MAX_OBS_SCALE = 200;
// Below ~100% the name box is too narrow to be worth it even with 2-line
// wrapping — raised from 50 so the slider can't land in a range that's
// known to look broken.
export const MIN_OBS_NAME_SCALE = 100;
export const MAX_OBS_NAME_SCALE = 300;
export const MIN_CHARACTER_SCALE = 40;
export const MAX_CHARACTER_SCALE = 250;

const BACKGROUNDS: readonly ObsBackground[] = ["transparent", "dark"];

// Pre-slider releases used a three-tier `size` param (sm/md/lg) instead of a
// continuous `scale` — a URL already pasted into someone's OBS Browser
// Source should keep working, so it's still read as a fallback when `scale`
// itself is absent.
const LEGACY_SIZE_SCALE: Record<string, number> = { sm: 75, md: 100, lg: 140 };

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function parseScale(params: URLSearchParams): number {
  const raw = params.get("scale");
  if (raw !== null) {
    const n = Number(raw);
    if (Number.isFinite(n))
      return Math.min(MAX_OBS_SCALE, Math.max(MIN_OBS_SCALE, n));
  }
  const legacySize = params.get("size");
  if (legacySize && legacySize in LEGACY_SIZE_SCALE)
    return LEGACY_SIZE_SCALE[legacySize];
  return DEFAULT_OBS_OPTIONS.scale;
}

function parseNameScale(params: URLSearchParams): number {
  const raw = params.get("nameScale");
  if (raw === null) return DEFAULT_OBS_OPTIONS.nameScale;
  const n = Number(raw);
  return Number.isFinite(n)
    ? Math.min(MAX_OBS_NAME_SCALE, Math.max(MIN_OBS_NAME_SCALE, n))
    : DEFAULT_OBS_OPTIONS.nameScale;
}

function parsePositions(params: URLSearchParams): ObsIconPosition[] | null {
  const raw = params.get("pos");
  if (!raw) return null;
  const numbers = raw.split(",").map(Number);
  if (numbers.length < 2 || numbers.some((n) => !Number.isFinite(n)))
    return null;
  const positions: ObsIconPosition[] = [];
  for (let i = 0; i + 1 < numbers.length; i += 2) {
    positions.push({
      x: Math.min(100, Math.max(0, numbers[i])),
      y: Math.min(100, Math.max(0, numbers[i + 1])),
    });
  }
  return positions.length > 0 ? positions : null;
}

function encodePositions(positions: ObsIconPosition[]): string {
  return positions.map((p) => `${round1(p.x)},${round1(p.y)}`).join(",");
}

function parseCharacterPosition(
  params: URLSearchParams,
): ObsIconPosition | null {
  const raw = params.get("cpos");
  if (!raw) return null;
  const [x, y] = raw.split(",").map(Number);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x: Math.min(100, Math.max(0, x)), y: Math.min(100, Math.max(0, y)) };
}

function parseCharacterScale(params: URLSearchParams): number {
  const raw = params.get("cscale");
  if (raw === null) return DEFAULT_OBS_OPTIONS.characterScale;
  const n = Number(raw);
  return Number.isFinite(n)
    ? Math.min(MAX_CHARACTER_SCALE, Math.max(MIN_CHARACTER_SCALE, n))
    : DEFAULT_OBS_OPTIONS.characterScale;
}

/** Reads overlay customization from ordinary query params (e.g.
 *  `?scale=140&names=0#/obs`) rather than localStorage, so the URL alone
 *  fully describes how the overlay renders — it has to work when pasted
 *  into OBS on a machine that's never opened the main site. The actual
 *  build-mirroring state in lib/obs-sync.ts used to assume the main tab and
 *  overlay share a browser profile too (they don't — see useObsRoomCode
 *  below), but now bridges across profiles via Firebase. */
export function useObsOverlayOptions(): ObsOverlayOptions {
  const [options, setOptions] =
    useState<ObsOverlayOptions>(DEFAULT_OBS_OPTIONS);

  useEffect(() => {
    function applyFromUrl() {
      const params = new URLSearchParams(window.location.search);
      const background = params.get("bg");
      setOptions({
        scale: parseScale(params),
        nameScale: parseNameScale(params),
        // A bare link with neither param present falls back to
        // DEFAULT_OBS_OPTIONS rather than hardcoding true/false here — the
        // modal always writes the param explicitly when it differs from
        // the default (see obsOverlayUrl below), but an old bookmarked or
        // hand-typed link might not carry it at all, and should still get
        // today's default look rather than reverting to whatever the
        // hardcoded fallback here used to be.
        showNames: params.has("names")
          ? params.get("names") !== "0"
          : DEFAULT_OBS_OPTIONS.showNames,
        showCharacter: params.has("char")
          ? params.get("char") !== "0"
          : DEFAULT_OBS_OPTIONS.showCharacter,
        background: BACKGROUNDS.includes(background as ObsBackground)
          ? (background as ObsBackground)
          : DEFAULT_OBS_OPTIONS.background,
        positions: parsePositions(params),
        characterPosition: parseCharacterPosition(params),
        characterScale: parseCharacterScale(params),
      });
    }
    applyFromUrl();
    window.addEventListener("hashchange", applyFromUrl);
    return () => window.removeEventListener("hashchange", applyFromUrl);
  }, []);

  return options;
}

/** True when the URL marks this tab as the stream overlay — primarily
 *  the `#/obs` hash, but also a `?obs=1` query param as a fallback (see
 *  obsOverlayUrl below). Reported in the wild: pasting the overlay link
 *  through certain link-preview rewriters, "safe link" wrappers, or a
 *  data-saving browser proxy (Yandex Browser's Turbo mode is a common
 *  one) can silently strip the `#...` fragment before it ever reaches
 *  OBS's Browser Source — since fragments are client-side-only, some of
 *  these tools drop them when reconstructing a URL. A query param
 *  survives that same mangling far more reliably, so it's checked
 *  first-class here, not just as a hash substitute.
 *  Used by layout chrome (Nav/Footer) to hide itself and by
 *  RandomizerContent to swap in the overlay instead of the normal app.
 *  Starts `false` to match the server's render (a static export can't know
 *  the hash/query at build time) and corrects itself right after mount,
 *  same pattern as the app's other client-only state. */
export function useIsObsMode(): boolean {
  const [isObs, setIsObs] = useState(false);

  useEffect(() => {
    function check() {
      const isQueryObs =
        new URLSearchParams(window.location.search).get("obs") === "1";
      setIsObs(window.location.hash === OBS_HASH || isQueryObs);
    }
    check();
    window.addEventListener("hashchange", check);
    return () => window.removeEventListener("hashchange", check);
  }, []);

  return isObs;
}

/** The OBS overlay's own room code, read from its URL (`?room=...#/obs`) —
 *  how it finds the right Firebase Realtime Database path to subscribe to
 *  (see lib/obs-sync.ts) without sharing cookies or localStorage with
 *  whatever browser generated the link — OBS's Browser Source never does. */
/** Firebase publish health, for the OBS modal's status row.
 *
 *  Reads the current value on mount rather than starting from a default:
 *  publishObsState runs on every generate, so by the time the modal is
 *  opened there is usually already a real status to show, and starting
 *  from "off" would flash "not syncing" at a streamer whose sync is fine. */
export function useObsPublishStatus(): ObsPublishStatus {
  // useSyncExternalStore rather than useState+useEffect: the status lives
  // in a module-level store that publishObsState writes to on every
  // generate, including before this component ever mounts. Seeding state
  // and then re-reading it in an effect would both trigger a cascading
  // render and still leave a window where a write between render and
  // effect is missed. getPublishStatus returns the same object identity
  // until something actually changes, which is what keeps this stable.
  return useSyncExternalStore(
    subscribeToPublishStatus,
    getPublishStatus,
    getPublishStatus,
  );
}

export function useObsRoomCode(): string | null {
  const [room, setRoom] = useState<string | null>(null);

  useEffect(() => {
    function applyFromUrl() {
      setRoom(new URLSearchParams(window.location.search).get("room"));
    }
    applyFromUrl();
    window.addEventListener("hashchange", applyFromUrl);
    return () => window.removeEventListener("hashchange", applyFromUrl);
  }, []);

  return room;
}

/** Builds the copyable OBS Browser Source URL. Always carries a `room` code
 *  (creating one on first call, see getOrCreateRoomCode) since that's what
 *  lets the overlay receive updates when it's running in OBS's own
 *  isolated browser profile — everything else is only written out when
 *  non-default, so a plain link with no customization stays short.
 *  Also always carries `obs=1` alongside the `#/obs` hash — belt and
 *  suspenders against the fragment getting stripped in transit (see
 *  useIsObsMode's docstring for why that's a real, reported failure
 *  mode), at the cost of a few extra characters on every link. */
export function obsOverlayUrl(
  options: Partial<ObsOverlayOptions> = {},
): string {
  if (typeof window === "undefined") return OBS_HASH;
  const params = new URLSearchParams();
  params.set("room", getOrCreateRoomCode());
  params.set("obs", "1");
  if (options.scale && options.scale !== DEFAULT_OBS_OPTIONS.scale) {
    params.set("scale", String(Math.round(options.scale)));
  }
  if (
    options.nameScale &&
    options.nameScale !== DEFAULT_OBS_OPTIONS.nameScale
  ) {
    params.set("nameScale", String(Math.round(options.nameScale)));
  }
  // Compared against the default rather than a hardcoded `false` — that
  // hardcoding is what let showNames's URL-parsing fallback (see
  // useObsOverlayOptions above) silently drift out of sync with
  // DEFAULT_OBS_OPTIONS.showNames when it changed; comparing against the
  // same constant here keeps them from being able to disagree again.
  if (
    options.showNames !== undefined &&
    options.showNames !== DEFAULT_OBS_OPTIONS.showNames
  ) {
    params.set("names", options.showNames ? "1" : "0");
  }
  if (
    options.showCharacter !== undefined &&
    options.showCharacter !== DEFAULT_OBS_OPTIONS.showCharacter
  ) {
    params.set("char", options.showCharacter ? "1" : "0");
  }
  if (
    options.background &&
    options.background !== DEFAULT_OBS_OPTIONS.background
  ) {
    params.set("bg", options.background);
  }
  if (options.positions && options.positions.length > 0) {
    params.set("pos", encodePositions(options.positions));
  }
  if (options.characterPosition) {
    params.set("cpos", encodePositions([options.characterPosition]));
  }
  if (
    options.characterScale &&
    options.characterScale !== DEFAULT_OBS_OPTIONS.characterScale
  ) {
    params.set("cscale", String(Math.round(options.characterScale)));
  }
  const query = params.toString();
  return `${window.location.origin}${window.location.pathname}${query ? `?${query}` : ""}${OBS_HASH}`;
}
