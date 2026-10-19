"use client";

import { Clock } from "lucide-react";
import { useT } from "@/lib/i18n";
import { withBasePath } from "@/lib/asset-path";
import { useFirstSeen } from "@/lib/use-first-seen";

/**
 * The map callouts tool, in the nav beside the hub link.
 *
 * In the nav rather than on the board, and that placement is the decision worth
 * recording. The board is the randomizer, and four passes went into taking
 * controls off it; this is a different tool that happens to live at the same
 * address, which is exactly what site navigation is for. Putting it in the
 * setup disclosure instead would have buried it — that panel is collapsed on a
 * first visit, so a "new" shine inside it is a shine nobody sees.
 *
 * A plain <a>, not next/link: the target is a self-contained static page under
 * public/, not a route in this app. next/link would try to prefetch an RSC
 * payload that does not exist.
 */
export function ClockLink() {
  const t = useT();
  const { isNew, markSeen } = useFirstSeen("dbd-randomizer:seen-clock");

  return (
    <a
      href={withBasePath("/clock/")}
      onClick={markSeen}
      /* The shine stops at the click, not at the page load. Someone who opens
         it in a new tab or middle-clicks has still seen it, and someone who
         merely scrolled past has not. */
      onAuxClick={markSeen}
      title={t({
        ru: "Часы на картах — колауты всех 58 карт",
        en: "Map clock callouts — all 58 maps",
      })}
      className="tap relative flex items-center gap-1.5 rounded-full border border-border px-3 py-2 text-control font-medium text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
    >
      <Clock className="size-3.5" />
      {t({ ru: "Часы", en: "Clock" })}
      {isNew && (
        <>
          {/* The sweep. A single pass of light across the control, slow enough
              to read as deliberate and quiet enough not to nag — it is a new
              tool, not an error. `overflow-hidden` keeps it inside the pill;
              `pointer-events-none` keeps it out of the click. */}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 overflow-hidden rounded-full"
          >
            <span className="clock-shine absolute inset-y-0 -left-full w-full" />
          </span>
          {/* What the sweep means, for anyone who cannot see it. Visually
              hidden rather than omitted: "new" is information, and a shine is
              not available to a screen reader at all. */}
          <span className="sr-only">{t({ ru: "— новое", en: "— new" })}</span>
          <span
            aria-hidden
            className="clock-dot absolute -top-0.5 -right-0.5 size-2 rounded-full bg-accent"
          />
        </>
      )}
    </a>
  );
}
