"use client";

import { Eye, PauseCircle } from "lucide-react";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n";
import type { ObsHold } from "@/lib/use-obs-hold";

/** Parks the overlay so rolling on the site doesn't play out on stream,
 *  with one button to send the build that was settled on. Sits above the
 *  preview because it changes what the preview means: while held, the
 *  preview is what the *streamer* sees, not what viewers do. */
export function ObsHoldControl({ hold }: { hold: ObsHold }) {
  const t = useT();

  return (
    <div
      className={cn(
        "mt-4 rounded-xl border p-3",
        hold.held ? "border-amber-400/40 bg-amber-400/5" : "border-border bg-background/60",
      )}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <button
          type="button"
          role="switch"
          aria-checked={hold.held}
          onClick={() => hold.setHeld(!hold.held)}
          className={cn(
            "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none",
            hold.held
              ? "border-amber-400/50 bg-amber-400/15 text-amber-300"
              : "border-border text-muted hover:bg-surface-hover hover:text-foreground",
          )}
        >
          <PauseCircle className="size-3.5" />
          {t({ ru: "Держать билд", en: "Hold the build" })}
        </button>

        {hold.held && (
          <button
            type="button"
            onClick={hold.reveal}
            className="flex items-center gap-1.5 rounded-full bg-accent px-3 py-1 text-[11px] font-semibold text-accent-foreground transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none"
          >
            <Eye className="size-3.5" />
            {t({ ru: "Показать", en: "Reveal" })}
            {hold.pending > 0 && (
              <span className="rounded-full bg-black/20 px-1.5 tabular-nums">{hold.pending}</span>
            )}
          </button>
        )}
      </div>

      <p className="mt-2 text-[11px] text-muted">
        {hold.held
          ? hold.pending > 0
            ? t({
                ru: `Зрители всё ещё видят прошлый билд. С тех пор роллов: ${hold.pending}.`,
                en: `Viewers are still on the previous build. Rolls since then: ${hold.pending}.`,
              })
            : t({
                ru: "Оверлей замер. Крути сколько нужно — на стрим уйдёт только то, что нажмёшь «Показать».",
                en: "The overlay is parked. Roll as much as you like — only what you Reveal goes out.",
              })
          : t({
              ru: "Каждый ролл сразу уходит в оверлей. Включи «Держать», чтобы сначала выбрать билд, а потом показать.",
              en: "Every roll goes straight to the overlay. Turn on Hold to pick a build first and show it when ready.",
            })}
      </p>
    </div>
  );
}
