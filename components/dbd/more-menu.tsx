"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n";

const PANEL_WIDTH = 288; // w-72
const VIEWPORT_MARGIN = 16;

/** A popover for the toolbar's less-frequent controls (Daily Challenge,
 *  custom seed, Stats, History) — keeps the always-visible row down to the
 *  handful of controls used on nearly every roll (role, mode, pool, OBS)
 *  instead of every control competing for space at once. */
export function MoreMenu({ children }: { children: ReactNode }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  // Offset (px, relative to the trigger's own left edge, matching
  // `position: absolute`'s coordinate space) applied to the panel's
  // `left`. Computed fresh each time the menu opens — see toggleOpen.
  const [panelOffset, setPanelOffset] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // This trigger sits inside a `justify-center` toolbar row that wraps
  // once its siblings don't all fit on one line — which one depends on
  // mode/language/role, so the trigger's actual on-screen position isn't
  // predictable enough for a fixed CSS anchor (`right-0` positioned the
  // panel mostly off the left edge whenever this wrapped to its own
  // centered row; a naive `left-1/2` center-under-trigger still overflowed
  // the *right* edge in "Both" mode's English layout, where the trigger
  // lands well right of viewport-center). Measuring the trigger's real
  // rect on open and clamping against the actual viewport width is the
  // only way to guarantee the panel stays fully on-screen regardless of
  // where the trigger ends up.
  function toggleOpen() {
    if (!open && rootRef.current) {
      const rect = rootRef.current.getBoundingClientRect();
      const idealLeft = rect.left + rect.width / 2 - PANEL_WIDTH / 2;
      const maxLeft = window.innerWidth - PANEL_WIDTH - VIEWPORT_MARGIN;
      const clampedLeft = Math.max(VIEWPORT_MARGIN, Math.min(idealLeft, maxLeft));
      setPanelOffset(clampedLeft - rect.left);
    }
    setOpen((o) => !o);
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={toggleOpen}
        aria-expanded={open}
        className={cn(
          "tap flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors",
          open
            ? "bg-surface-hover text-foreground"
            : "text-muted hover:bg-surface-hover hover:text-foreground",
        )}
      >
        <MoreHorizontal className="size-3.5" />
        {t({ ru: "Ещё", en: "More" })}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: -6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -6 }}
            transition={{ duration: 0.15 }}
            style={{ left: panelOffset }}
            className="absolute top-full z-30 mt-2 w-72 max-w-[calc(100vw-2rem)] origin-top rounded-2xl border border-border bg-surface p-3 shadow-xl"
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
