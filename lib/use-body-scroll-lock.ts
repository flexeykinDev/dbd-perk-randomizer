"use client";

import { useEffect } from "react";

// Ref-counted rather than a plain set/restore: more than one locking
// surface can legitimately be open at once (opening a perk's detail modal
// from inside the pool manager, for instance), and a naive
// "overflow:hidden on open, restore on close" would have the first one to
// close hand scrolling back to the page while the second is still covering
// it. The body only unlocks when the last lock is released.
let lockCount = 0;
let restoreOverflow = "";
let restorePaddingRight = "";

function lock(): void {
  lockCount++;
  if (lockCount > 1) return;

  const { body } = document;
  restoreOverflow = body.style.overflow;
  restorePaddingRight = body.style.paddingRight;

  // Removing the scrollbar changes the viewport width, which visibly shifts
  // the page underneath the backdrop on desktop. Replacing its width with
  // padding keeps everything still. Comes out as 0 on mobile and on
  // overlay-scrollbar systems, where there's nothing to compensate for.
  const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
  if (scrollbarWidth > 0) {
    const current = parseFloat(getComputedStyle(body).paddingRight) || 0;
    body.style.paddingRight = `${current + scrollbarWidth}px`;
  }
  body.style.overflow = "hidden";
}

function unlock(): void {
  lockCount = Math.max(0, lockCount - 1);
  if (lockCount > 0) return;
  document.body.style.overflow = restoreOverflow;
  document.body.style.paddingRight = restorePaddingRight;
}

/** Freezes background page scrolling while `active` is true.
 *
 *  Without this, scrolling inside a modal that has reached its end keeps
 *  going and scrolls the page behind it instead — on a phone that reads as
 *  the modal being stuck, since the thing under your finger stops moving
 *  while something else does. Pair with `overscroll-contain` on the
 *  scrollable element itself (see the `.modal-scroll` utility in
 *  globals.css) so the chain is broken at both ends. */
export function useBodyScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    lock();
    return unlock;
  }, [active]);
}
