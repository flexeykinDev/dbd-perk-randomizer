"use client";

// Keeps the address bar describing the build on screen.
//
// The whole of the format lives in lib/share-link.ts — this is only the
// effect that fires it, which is why it is five lines of its own and not a
// hook with opinions. It exists so the board states the dependency list once
// instead of carrying eighty lines of URLSearchParams in the middle of its
// render.
//
// Deliberately gated on `mounted`: the first client render has to match the
// server's HTML, and a seeded or shared build is not applied until the mount
// effect has run. Writing the URL before that would publish a link to the
// default build over the top of the one the visitor arrived with.
import { useEffect } from "react";
import { replaceShareQuery, type ShareLinkState } from "./share-link";

export function useShareUrl({
  mounted,
  role,
  mode,
  coherence,
  seed,
  perks,
  loadoutPieces,
  squad,
}: ShareLinkState & { mounted: boolean }): void {
  useEffect(() => {
    if (!mounted) return;
    replaceShareQuery({
      role,
      mode,
      coherence,
      seed,
      perks,
      loadoutPieces,
      squad,
    });
    // The fields, not the object they arrived in: a caller writing the
    // argument as a literal hands over a fresh object on every render, and
    // depending on that would rewrite the address bar on each one.
  }, [mounted, role, mode, coherence, seed, perks, loadoutPieces, squad]);
}
