"use client";

import { useEffect, useState } from "react";

/** Wide screen AND a real pointer.
 *
 *  Both halves matter for the presentations this gates — Ritual and Slots.
 *  They run a WebGL or canvas loop and ask for a keypress, so a phone would
 *  pay the battery for something it has no key to drive, and a narrow window
 *  has nowhere to lay out four cards or four reels without them collapsing.
 *  A tablet reports a coarse pointer at desktop width, which is exactly the
 *  case width alone would get wrong.
 *
 *  Starts false and resolves after mount, so the server render and the first
 *  client render agree; a desktop-only control appearing a frame late is
 *  invisible, a hydration mismatch is not. */
export function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(min-width: 1024px) and (pointer: fine)");
    const sync = () => setIsDesktop(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  return isDesktop;
}
