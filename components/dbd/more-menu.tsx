"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n";

/** A popover for the toolbar's less-frequent controls (Daily Challenge,
 *  custom seed, Stats, History) — keeps the always-visible row down to the
 *  handful of controls used on nearly every roll (role, mode, pool, OBS)
 *  instead of every control competing for space at once. */
export function MoreMenu({ children }: { children: ReactNode }) {
  const t = useT();
  const [open, setOpen] = useState(false);
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

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={cn(
          "flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors",
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
            className="absolute top-full right-0 z-30 mt-2 w-72 origin-top-right rounded-2xl border border-border bg-surface p-3 shadow-xl"
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
