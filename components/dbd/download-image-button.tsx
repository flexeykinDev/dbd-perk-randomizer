"use client";

import { ChevronDown, ImageDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n";
import type { ShareCardLayout } from "./share-card";

const FORMAT_OPTIONS: readonly {
  layout: ShareCardLayout;
  label: { ru: string; en: string };
  hint: { ru: string; en: string };
}[] = [
  {
    layout: "landscape",
    label: { ru: "Стандартный (16:9)", en: "Landscape / Standard (16:9)" },
    hint: { ru: "Discord, X/Twitter", en: "Discord, X/Twitter" },
  },
  {
    layout: "story",
    label: { ru: "История (9:16)", en: "Story / Vertical (9:16)" },
    hint: { ru: "Instagram, TikTok", en: "Instagram, TikTok" },
  },
];

/** Single "Download Image ▾" trigger that replaces two separate buttons —
 *  opens a small menu of format presets instead of making the user parse
 *  two differently-worded buttons to figure out which one is "the normal
 *  one" and which is "the vertical one". */
export function DownloadImageButton({
  onSelect,
  generating,
  disabled,
  layouts,
}: {
  onSelect: (layout: ShareCardLayout) => void;
  generating: ShareCardLayout | null;
  disabled: boolean;
  /** Which formats to offer. Both, unless the caller only has one card —
   *  the squad poster is 16:9 only. Left undefined rather than defaulted to
   *  the full list in the signature so the common call site stays a
   *  three-prop one. */
  layouts?: readonly ShareCardLayout[];
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const isGenerating = !!generating;

  return (
    <div ref={rootRef} className="relative w-full sm:w-auto">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled || isGenerating}
        aria-haspopup="menu"
        aria-expanded={open}
        className="tap flex w-full items-center justify-center gap-1.5 rounded-full border border-transparent px-3 py-1.5 text-control font-medium text-muted transition-colors hover:border-border hover:bg-surface-hover hover:text-foreground disabled:pointer-events-none disabled:opacity-40 sm:w-auto"
      >
        <ImageDown className="size-3.5" />
        {isGenerating
          ? t({ ru: "Готовим картинку…", en: "Generating…" })
          : t({ ru: "Скачать картинку", en: "Download Image" })}
        <ChevronDown className={cn("size-3 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div
          role="menu"
          aria-label={t({ ru: "Формат картинки", en: "Image format" })}
          className="absolute top-full left-1/2 z-20 mt-1.5 w-56 -translate-x-1/2 overflow-hidden rounded-xl border border-border bg-surface py-1 shadow-2xl"
        >
          {(layouts
            ? FORMAT_OPTIONS.filter((o) => layouts.includes(o.layout))
            : FORMAT_OPTIONS
          ).map((option) => (
            <button
              key={option.layout}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onSelect(option.layout);
              }}
              className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left transition-colors hover:bg-surface-hover focus-visible:bg-surface-hover focus-visible:outline-none"
            >
              <span className="text-control font-medium text-foreground">{t(option.label)}</span>
              <span className="text-hint text-muted">{t(option.hint)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
