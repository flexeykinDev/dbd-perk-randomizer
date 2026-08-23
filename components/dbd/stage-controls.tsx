"use client";

import { Copy, Dices, Lock, LockOpen } from "lucide-react";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n";
import type { Perk } from "@/lib/types";

/* The interaction layer for the canvas presentations.
 *
 * Canvas draws pixels and answers no questions: it has no focus, no
 * accessible name, and nothing for a click to land on. Switching to Ritual or
 * Slots therefore took away per-perk copy, the description modal and the pin
 * toggle — everything the grid offers by being made of buttons. A theme is
 * allowed to change how a build looks; it is not allowed to make the build do
 * less.
 *
 * So the stage keeps the picture and this puts real buttons back on top of
 * it, positioned from the same layout function the canvas paints with (see
 * ritualCardRect / reelRect). Hit-testing inside the canvas would have been
 * the other option and gives up focus order, tab stops and screen-reader
 * names to save nothing.
 */

export interface SlotRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function StageControls({
  perks,
  language,
  rects,
  pinnedSlots,
  onOpenDetail,
  onCopy,
  onTogglePin,
  onRerollSlot,
}: {
  perks: Perk[];
  language: "en" | "ru";
  /** One rect per perk, in CSS pixels relative to the stage. */
  rects: SlotRect[];
  /** Slot index -> pinned perk slug, exactly as PerkGrid receives it. */
  pinnedSlots?: Record<number, string>;
  onOpenDetail: (perk: Perk) => void;
  onCopy: (perk: Perk) => void;
  onTogglePin?: (slot: number, slug: string) => void;
  onRerollSlot?: (slot: number) => void;
}) {
  const t = useT();
  if (rects.length === 0) return null;

  return (
    <div className="absolute inset-0">
      {perks.map((perk, i) => {
        const rect = rects[i];
        if (!rect) return null;
        const pinned = pinnedSlots?.[i] !== undefined;
        // Icon buttons tuck under the card. Sized off the slot so they stay
        // proportionate as the stage scales, floored at something a thumb can
        // still find.
        const btn = Math.max(26, Math.min(32, rect.w * 0.26));
        return (
          <div key={perk.slug + i}>
            {/* The card itself: opens the same description a grid card does. */}
            <button
              type="button"
              onClick={() => onOpenDetail(perk)}
              aria-label={t({ ru: "Описание:", en: "Description:" }) + " " + perk.name[language]}
              data-stage-slot={i}
              className="absolute cursor-pointer rounded-xl focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none"
              style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
            />
            <div
              className="absolute flex items-center justify-center gap-1"
              style={{
                left: rect.x,
                top: rect.y + rect.h + 4,
                width: rect.w,
              }}
            >
              <StageButton
                size={btn}
                label={t({ ru: "Копировать", en: "Copy" })}
                onClick={() => onCopy(perk)}
              >
                <Copy style={{ width: btn * 0.44, height: btn * 0.44 }} />
              </StageButton>
              {onTogglePin && (
                <StageButton
                  size={btn}
                  active={pinned}
                  label={
                    pinned
                      ? t({ ru: "Открепить", en: "Unpin" })
                      : t({ ru: "Закрепить", en: "Pin" })
                  }
                  onClick={() => onTogglePin(i, perk.slug)}
                >
                  {pinned ? (
                    <Lock style={{ width: btn * 0.44, height: btn * 0.44 }} />
                  ) : (
                    <LockOpen style={{ width: btn * 0.44, height: btn * 0.44 }} />
                  )}
                </StageButton>
              )}
              {onRerollSlot && (
                <StageButton
                  size={btn}
                  label={t({ ru: "Переролл слота", en: "Reroll slot" })}
                  onClick={() => onRerollSlot(i)}
                >
                  <Dices style={{ width: btn * 0.44, height: btn * 0.44 }} />
                </StageButton>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function StageButton({
  size,
  label,
  active,
  onClick,
  children,
}: {
  size: number;
  label: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full border transition-colors focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none",
        active
          ? "border-accent/60 bg-accent/15 text-accent"
          : "border-border bg-surface/70 text-muted hover:bg-surface-hover hover:text-foreground",
      )}
      style={{ width: size, height: size }}
    >
      {children}
    </button>
  );
}
