"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Sparkles } from "lucide-react";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n";
import {
  isAvailable,
  PRESENTATION_HINT,
  PRESENTATION_LABEL,
  PRESENTATIONS,
  type Presentation,
} from "@/lib/use-presentation";

/** Picks how a roll is shown. Every option produces the same build — see the
 *  header of lib/use-presentation.ts. */
export function PresentationPicker({
  value,
  onChange,
  isDesktop,
}: {
  value: Presentation;
  onChange: (p: Presentation) => void;
  isDesktop: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="presentation-picker"
        className="tap flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
      >
        <Sparkles className="size-3.5 shrink-0" />
        {t(PRESENTATION_LABEL[value])}
        <ChevronDown
          className={cn("size-3.5 shrink-0 transition-transform", open && "rotate-180")}
        />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute top-full right-0 z-30 mt-2 w-64 max-w-[calc(100vw-2rem)] origin-top rounded-2xl border border-border bg-surface p-1.5 shadow-xl"
        >
          {PRESENTATIONS.map((p) => {
            const usable = isAvailable(p, isDesktop);
            return (
              <button
                key={p}
                type="button"
                role="menuitemradio"
                aria-checked={value === p}
                disabled={!usable}
                onClick={() => {
                  onChange(p);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-start gap-2.5 rounded-xl px-3 py-2 text-left transition-colors",
                  usable
                    ? "hover:bg-surface-hover"
                    : "cursor-not-allowed opacity-45",
                  value === p && "bg-surface-hover",
                )}
              >
                <Check
                  className={cn(
                    "mt-0.5 size-3.5 shrink-0",
                    value === p ? "text-accent" : "opacity-0",
                  )}
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-foreground">
                    {t(PRESENTATION_LABEL[p])}
                  </span>
                  <span className="block text-[0.6875rem] leading-snug text-muted">
                    {t(PRESENTATION_HINT[p])}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
