"use client";

import { useEffect, useState } from "react";
import type { PerkRole } from "./types";

/* Embed mode: the randomizer as a small block on somebody else's page.
 *
 * Same trick the OBS overlay uses — a hash the static export never has to
 * route, checked on the client (see lib/use-obs-mode.ts). There is no server
 * here to add a route to, and a second entry in the export would be a second
 * page to keep in step with this one.
 *
 * Options come from the query string, not the hash fragment, for the same
 * reason the overlay's do: they sit alongside the `r=` that every share link
 * this site writes already carries, so an embed URL is an ordinary link with
 * a hash on the end. Nothing about existing links changes.
 */

const EMBED_HASH = "#/embed";

const ROLE_FROM_SHORT: Record<string, PerkRole> = { s: "survivor", k: "killer" };

/** Four is a build. One to five because the board itself allows that range,
 *  and an embed that disagreed with the site it links to would be odd. */
const MIN_PERKS = 1;
const MAX_PERKS = 5;
const DEFAULT_PERKS = 4;

export interface EmbedOptions {
  role: PerkRole;
  perkCount: number;
}

export function useIsEmbedMode(): boolean {
  const [isEmbed, setIsEmbed] = useState(false);

  useEffect(() => {
    function check() {
      // `?embed=1` alongside the hash, matching the overlay's `?obs=1`: a
      // hash is the first thing a link shortener or a chat client drops,
      // and an embed that silently became the whole site inside a 320px
      // iframe is a worse failure than a slightly longer URL.
      const isQueryEmbed = new URLSearchParams(window.location.search).get("embed") === "1";
      setIsEmbed(window.location.hash === EMBED_HASH || isQueryEmbed);
    }
    check();
    window.addEventListener("hashchange", check);
    return () => window.removeEventListener("hashchange", check);
  }, []);

  return isEmbed;
}

/** Reads what the embed should show. Defaults are a survivor build of four,
 *  so `#/embed` on its own is a valid embed rather than a blank one. */
export function readEmbedOptions(search: string): EmbedOptions {
  const params = new URLSearchParams(search);

  const short = params.get("r");
  const legacy = params.get("role");
  const role: PerkRole =
    (short ? ROLE_FROM_SHORT[short] : undefined) ??
    (legacy === "survivor" || legacy === "killer" ? legacy : "survivor");

  const n = Number(params.get("n"));
  const perkCount =
    Number.isFinite(n) && n >= MIN_PERKS && n <= MAX_PERKS ? Math.floor(n) : DEFAULT_PERKS;

  return { role, perkCount };
}

export function useEmbedOptions(): EmbedOptions {
  // Read once on mount rather than per render: the host page cannot change
  // our query string without reloading the iframe, and re-parsing on every
  // roll would be work for nothing.
  const [options, setOptions] = useState<EmbedOptions>({
    role: "survivor",
    perkCount: DEFAULT_PERKS,
  });

  useEffect(() => {
    function read() {
      setOptions(readEmbedOptions(window.location.search));
    }
    read();
  }, []);

  return options;
}

/** The URL to hand somebody for their own page. */
export function embedUrl(origin: string, { role, perkCount }: Partial<EmbedOptions> = {}): string {
  const params = new URLSearchParams();
  if (role) params.set("r", role === "killer" ? "k" : "s");
  if (perkCount) params.set("n", String(perkCount));
  const query = params.toString();
  return `${origin}${query ? `?${query}` : ""}${EMBED_HASH}`;
}
