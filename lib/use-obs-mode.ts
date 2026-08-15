"use client";

import { useEffect, useState } from "react";
import { getOrCreateRoomCode } from "./obs-sync";

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
  showNames: boolean;
  background: ObsBackground;
  /** Per-slot custom positions, indexed the same as the current build's
   *  perk list. `null` means "no override — use the default centered row
   *  layout," which is also what a fresh install and a `pos`-less URL get. */
  positions: ObsIconPosition[] | null;
}

export const DEFAULT_OBS_OPTIONS: ObsOverlayOptions = {
  scale: 100,
  showNames: true,
  background: "transparent",
  positions: null,
};

export const MIN_OBS_SCALE = 50;
export const MAX_OBS_SCALE = 200;

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
    if (Number.isFinite(n)) return Math.min(MAX_OBS_SCALE, Math.max(MIN_OBS_SCALE, n));
  }
  const legacySize = params.get("size");
  if (legacySize && legacySize in LEGACY_SIZE_SCALE) return LEGACY_SIZE_SCALE[legacySize];
  return DEFAULT_OBS_OPTIONS.scale;
}

function parsePositions(params: URLSearchParams): ObsIconPosition[] | null {
  const raw = params.get("pos");
  if (!raw) return null;
  const numbers = raw.split(",").map(Number);
  if (numbers.length < 2 || numbers.some((n) => !Number.isFinite(n))) return null;
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

/** Reads overlay customization from ordinary query params (e.g.
 *  `?scale=140&names=0#/obs`) rather than localStorage, so the URL alone
 *  fully describes how the overlay renders — it has to work when pasted
 *  into OBS on a machine that's never opened the main site. The actual
 *  build-mirroring state in lib/obs-sync.ts used to assume the main tab and
 *  overlay share a browser profile too (they don't — see useObsRoomCode
 *  below), but now bridges across profiles via Firebase. */
export function useObsOverlayOptions(): ObsOverlayOptions {
  const [options, setOptions] = useState<ObsOverlayOptions>(DEFAULT_OBS_OPTIONS);

  useEffect(() => {
    function applyFromUrl() {
      const params = new URLSearchParams(window.location.search);
      const background = params.get("bg");
      setOptions({
        scale: parseScale(params),
        showNames: params.get("names") !== "0",
        background: BACKGROUNDS.includes(background as ObsBackground)
          ? (background as ObsBackground)
          : DEFAULT_OBS_OPTIONS.background,
        positions: parsePositions(params),
      });
    }
    applyFromUrl();
    window.addEventListener("hashchange", applyFromUrl);
    return () => window.removeEventListener("hashchange", applyFromUrl);
  }, []);

  return options;
}

/** True when the URL's hash marks this tab as the stream overlay
 *  (`#/obs`) — used by layout chrome (Nav/Footer) to hide itself and by
 *  RandomizerContent to swap in the overlay instead of the normal app.
 *  Starts `false` to match the server's render (a static export can't know
 *  the hash at build time — hashes never even reach the server) and
 *  corrects itself right after mount, same pattern as the app's other
 *  client-only state. */
export function useIsObsMode(): boolean {
  const [isObs, setIsObs] = useState(false);

  useEffect(() => {
    function check() {
      setIsObs(window.location.hash === OBS_HASH);
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
 *  non-default, so a plain link with no customization stays short. */
export function obsOverlayUrl(options: Partial<ObsOverlayOptions> = {}): string {
  if (typeof window === "undefined") return OBS_HASH;
  const params = new URLSearchParams();
  params.set("room", getOrCreateRoomCode());
  if (options.scale && options.scale !== DEFAULT_OBS_OPTIONS.scale) {
    params.set("scale", String(Math.round(options.scale)));
  }
  if (options.showNames === false) params.set("names", "0");
  if (options.background && options.background !== DEFAULT_OBS_OPTIONS.background) {
    params.set("bg", options.background);
  }
  if (options.positions && options.positions.length > 0) {
    params.set("pos", encodePositions(options.positions));
  }
  const query = params.toString();
  return `${window.location.origin}${window.location.pathname}${query ? `?${query}` : ""}${OBS_HASH}`;
}
