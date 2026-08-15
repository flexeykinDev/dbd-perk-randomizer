"use client";

import { useEffect, useState } from "react";

const OBS_HASH = "#/obs";

export type ObsCardSize = "sm" | "md" | "lg";
export type ObsBackground = "transparent" | "dark";

export interface ObsOverlayOptions {
  size: ObsCardSize;
  showNames: boolean;
  background: ObsBackground;
}

export const DEFAULT_OBS_OPTIONS: ObsOverlayOptions = {
  size: "md",
  showNames: true,
  background: "transparent",
};

const CARD_SIZES: readonly ObsCardSize[] = ["sm", "md", "lg"];
const BACKGROUNDS: readonly ObsBackground[] = ["transparent", "dark"];

/** Reads overlay customization from ordinary query params (e.g.
 *  `?size=lg&names=0#/obs`) rather than localStorage, so the URL alone
 *  fully describes how the overlay renders — it has to work when pasted
 *  into OBS on a machine that's never opened the main site, unlike the
 *  build-mirroring state in lib/obs-sync.ts which reasonably assumes the
 *  main tab and overlay share a browser profile. */
export function useObsOverlayOptions(): ObsOverlayOptions {
  const [options, setOptions] = useState<ObsOverlayOptions>(DEFAULT_OBS_OPTIONS);

  useEffect(() => {
    function applyFromUrl() {
      const params = new URLSearchParams(window.location.search);
      const size = params.get("size");
      const background = params.get("bg");
      setOptions({
        size: CARD_SIZES.includes(size as ObsCardSize) ? (size as ObsCardSize) : DEFAULT_OBS_OPTIONS.size,
        showNames: params.get("names") !== "0",
        background: BACKGROUNDS.includes(background as ObsBackground)
          ? (background as ObsBackground)
          : DEFAULT_OBS_OPTIONS.background,
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

/** Builds the copyable OBS Browser Source URL. Only non-default options are
 *  written out, so the plain URL (no customization) stays exactly as short
 *  as it was before this existed. */
export function obsOverlayUrl(options: Partial<ObsOverlayOptions> = {}): string {
  if (typeof window === "undefined") return OBS_HASH;
  const params = new URLSearchParams();
  if (options.size && options.size !== DEFAULT_OBS_OPTIONS.size) params.set("size", options.size);
  if (options.showNames === false) params.set("names", "0");
  if (options.background && options.background !== DEFAULT_OBS_OPTIONS.background) {
    params.set("bg", options.background);
  }
  const query = params.toString();
  return `${window.location.origin}${window.location.pathname}${query ? `?${query}` : ""}${OBS_HASH}`;
}
