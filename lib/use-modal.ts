"use client";

// What every dialog on this site needs and only one of them had.
//
// An audit of all eight found `role="dialog"` and `aria-modal` on the OBS
// modal alone, no Escape handler anywhere — not locally, not globally in
// use-board-shortcuts.ts — and no focus management at all. In practice:
// opening a perk's description gave a keyboard user nothing to close it
// with but tabbing to the ✕; a screen reader announced a plain block and
// never said the rest of the page had gone inert; and focus stayed behind
// the backdrop, on controls nobody could see.
//
// None of that is per-modal behaviour, so it lives here rather than being
// written eight times.
import { useCallback, useEffect, useRef } from "react";
import { useBodyScrollLock } from "./use-body-scroll-lock";

/** Everything tabbable, in document order. `:not([tabindex="-1"])` keeps
 *  the dialog container itself out — it takes focus on open, but Tab
 *  should move to the first real control rather than back to the box. */
const FOCUSABLE =
  'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

function focusableIn(container: HTMLElement | null): HTMLElement[] {
  if (!container) return [];
  return [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => el.offsetParent !== null || el === document.activeElement,
  );
}

export function useModal({
  open,
  onClose,
  /** Used when the dialog has no visible heading to point at. A modal with
   *  a title should pass `labelledBy` instead. */
  label,
  labelledBy,
}: {
  open: boolean;
  onClose: () => void;
  label?: string;
  labelledBy?: string;
}) {
  useBodyScrollLock(open);

  const cardRef = useRef<HTMLDivElement | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  // Focus in on open, focus back out on close. Kept apart from the key
  // handler below so that a caller passing an inline `onClose` — most of
  // them do — doesn't re-run this and bounce focus on every render.
  useEffect(() => {
    if (!open) return;
    openerRef.current = document.activeElement as HTMLElement | null;
    cardRef.current?.focus();
    return () => {
      // Back to whatever opened it, so closing a dialog doesn't dump the
      // caret at the top of the document.
      openerRef.current?.focus?.();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        // Stopped here so that a dialog opened from inside another one
        // (a perk's description from the pool manager) closes only the
        // top one per press.
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = focusableIn(cardRef.current);
      if (focusable.length === 0) {
        // Nothing to move between; keep focus in the dialog rather than
        // letting Tab escape to the page underneath.
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      // Wraps at both ends, and also catches the case where focus somehow
      // sits outside the dialog entirely.
      if (event.shiftKey && (active === first || !cardRef.current?.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }
    // Capture phase: the dialog's own inputs would otherwise see Escape
    // first, and some of them (a search box) treat it as "clear me".
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [open, onClose]);

  const attachCard = useCallback((el: HTMLDivElement | null) => {
    cardRef.current = el;
  }, []);

  return {
    /** Attach to the dialog's own card, not the backdrop — the backdrop is
     *  the click-away surface, the card is the dialog. */
    attachCard,
    dialogProps: {
      role: "dialog" as const,
      "aria-modal": true,
      "aria-label": labelledBy ? undefined : label,
      "aria-labelledby": labelledBy,
      // Lets the container itself hold focus the moment it opens, before
      // the user has tabbed to anything.
      tabIndex: -1,
    },
  };
}
