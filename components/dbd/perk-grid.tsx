"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Copy, Dices, Info, Lock, LockOpen, X } from "lucide-react";
import type { Perk } from "@/lib/types";
import { withBasePath } from "@/lib/asset-path";
import { isNewPerk, getCharacterPortrait } from "@/lib/perks";
import { ROLE_COLOR } from "@/lib/role-color";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n";
import { getCharacterName } from "@/lib/character-name";
import { getPerkDescription } from "@/lib/perk-description";
import { useDescription } from "@/lib/descriptions";
import { useModal } from "@/lib/use-modal";
import { Highlighted } from "./highlighted-text";

/* The small circular controls in a perk card's top-right corner. Split into
   base/idle so the padlock can reuse the shape while supplying its own
   always-visible pinned colours. The dark plate is deliberate and doesn't
   follow the theme: these sit on top of the perk artwork, which is light
   line-art in both themes, so a themed plate would vanish on one of them. */
const CORNER_BUTTON_BASE =
  "flex size-6 items-center justify-center rounded-full backdrop-blur-sm transition-opacity disabled:pointer-events-none disabled:opacity-30";
const CORNER_BUTTON_IDLE =
  "bg-black/40 text-white/80 opacity-0 group-hover:opacity-100 hover:bg-black/60 hover:text-white focus-visible:opacity-100";
const CORNER_BUTTON = cn(CORNER_BUTTON_BASE, CORNER_BUTTON_IDLE);

export function PerkGrid({
  perks,
  language,
  loading = false,
  emptyMessage,
  onCopy,
  pinnedSlots,
  onTogglePin,
  onRerollSlot,
}: {
  perks: Perk[];
  language: "en" | "ru";
  loading?: boolean;
  emptyMessage?: string;
  onCopy: (perk: Perk) => void;
  /** Slot index -> pinned slug. Omitted where pinning doesn't apply (a
   *  shared or seeded build), which also hides the padlocks. */
  pinnedSlots?: Record<number, string>;
  onTogglePin?: (slot: number, slug: string) => void;
  onRerollSlot?: (slot: number) => void;
}) {
  const t = useT();
  const [detailPerk, setDetailPerk] = useState<Perk | null>(null);

  if (loading) {
    return (
      <div className="grid min-h-[220px] w-full max-w-4xl grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="aspect-square animate-pulse rounded-2xl border border-border bg-surface"
          />
        ))}
      </div>
    );
  }

  if (perks.length === 0) {
    return (
      <div className="flex min-h-[220px] w-full max-w-md items-center justify-center rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted">
        {emptyMessage ?? t({ ru: "Пусто", en: "Nothing here" })}
      </div>
    );
  }

  return (
    <>
      {/* w-full max-w-4xl (not just content-sized) — the parent's flex
          `items-center` shrinks a bare grid down to exactly 4 cards' natural
          width, leaving most of the page as empty margin on anything wider
          than a phone (measured ~130px cards on a 1280px-wide viewport).
          Letting the grid claim real width and scaling the card art with it
          (see the icon's responsive size-* below) is what actually uses the
          space instead of just centering a small island in it. */}
      <div className="grid min-h-[220px] w-full max-w-4xl grid-cols-2 gap-4 sm:grid-cols-4">
        <AnimatePresence mode="popLayout">
          {perks.map((perk, index) => {
            const roleColor = ROLE_COLOR[perk.role];
            const isPinned = pinnedSlots?.[index] === perk.slug;
            return (
              <motion.div
                key={perk.slug}
                initial={{ opacity: 0, scale: 0.85, y: 8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.85 }}
                transition={{ duration: 0.25, delay: index * 0.05 }}
                role="button"
                tabIndex={0}
                // Marks the card itself for the e2e suite, which has to tell
                // the live build apart from the outgoing cards AnimatePresence
                // keeps mounted through their exit transition.
                data-perk-card="1"
                onClick={() => setDetailPerk(perk)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setDetailPerk(perk);
                  }
                }}
                aria-label={t({ ru: "Описание:", en: "Description:" }) + " " + perk.name[language]}
                className={cn(
                  "group relative flex cursor-pointer flex-col items-center gap-2 rounded-2xl border border-border bg-surface p-3 text-center transition-colors hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:outline-none",
                  roleColor.hoverBorder,
                )}
              >
                {isNewPerk(perk) && (
                  <span
                    className={cn(
                      "absolute -top-2 -left-2 z-10 rounded-full px-2 py-0.5 text-[10px] font-bold text-white shadow",
                      perk.role === "survivor" ? "bg-sky-500" : "bg-rose-500",
                    )}
                  >
                    {t({ ru: "НОВОЕ", en: "NEW" })}
                  </span>
                )}

                {/* Per-card controls, grouped in one row rather than three
                    separately-positioned buttons so they can't drift into
                    each other as the card resizes. */}
                <div className="absolute top-1.5 right-1.5 z-10 flex items-center gap-1">
                  {onRerollSlot && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRerollSlot(index);
                      }}
                      disabled={isPinned}
                      // Names the keyboard shortcut in the tooltip — the
                      // digit hotkeys are otherwise invisible, and this is
                      // the button they correspond to.
                      title={t({
                        ru: `Перебросить этот перк (${index + 1})`,
                        en: `Reroll this perk (${index + 1})`,
                      })}
                      aria-label={t({
                        ru: "Перебросить этот перк",
                        en: "Reroll this perk",
                      })}
                      className={CORNER_BUTTON}
                    >
                      <Dices className="size-3.5" />
                    </button>
                  )}

                  {onTogglePin && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onTogglePin(index, perk.slug);
                      }}
                      aria-pressed={isPinned}
                      aria-label={
                        isPinned
                          ? t({ ru: "Открепить перк", en: "Unpin perk" })
                          : t({ ru: "Закрепить перк", en: "Pin perk" })
                      }
                      className={cn(
                        CORNER_BUTTON_BASE,
                        // A pinned slot keeps its padlock visible at all
                        // times — it isn't a hover affordance like the info
                        // button, it's the only thing on screen saying why
                        // this slot stopped changing when you rerolled.
                        isPinned
                          ? "bg-accent text-accent-foreground opacity-100"
                          : CORNER_BUTTON_IDLE,
                      )}
                    >
                      {isPinned ? (
                        <Lock className="size-3.5" />
                      ) : (
                        <LockOpen className="size-3.5" />
                      )}
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDetailPerk(perk);
                    }}
                    aria-label={
                      t({ ru: "Описание:", en: "Description:" }) + " " + perk.name[language]
                    }
                    className={CORNER_BUTTON}
                  >
                    <Info className="size-3.5" />
                  </button>
                </div>

                {/* eslint-disable-next-line @next/next/no-img-element -- next/image ignores basePath for unoptimized runtime src, see lib/asset-path.ts */}
                <img
                  src={withBasePath(perk.icon)}
                  alt={perk.name[language]}
                  width={112}
                  height={112}
                  className="size-24 rounded-xl icon-art object-cover transition-transform group-hover:scale-105 sm:size-28 lg:size-32"
                />
                <span className="text-xs font-medium text-foreground">{perk.name[language]}</span>

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCopy(perk);
                  }}
                  className="mt-auto flex w-full items-center justify-center gap-1.5 rounded-lg border border-border py-1.5 text-xs font-medium text-muted transition-colors hover:border-accent/50 hover:bg-accent/10 hover:text-accent"
                >
                  <Copy className="size-3.5" />
                  {t({ ru: "Копировать", en: "Copy" })}
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      <PerkDetailModal
        perk={detailPerk}
        language={language}
        onCopy={onCopy}
        onClose={() => setDetailPerk(null)}
      />
    </>
  );
}

function PerkDetailModal({
  perk,
  language,
  onCopy,
  onClose,
}: {
  perk: Perk | null;
  language: "en" | "ru";
  onCopy: (perk: Perk) => void;
  onClose: () => void;
}) {
  const t = useT();
  const roleColor = perk ? ROLE_COLOR[perk.role] : null;
  const portrait = perk ? getCharacterPortrait(perk.character) : undefined;
  const { attachCard, dialogProps } = useModal({
    open: perk !== null,
    onClose,
    label: perk ? perk.name[language] : undefined,
  });

  return (
    <AnimatePresence>
      {perk && roleColor && (
        <motion.div
          initial={{ opacity: 0, pointerEvents: "none" }}
          animate={{ opacity: 1, pointerEvents: "auto" }}
          exit={{ opacity: 0, pointerEvents: "none" }}
          onClick={onClose}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ type: "spring", stiffness: 400, damping: 32 }}
            onClick={(e) => e.stopPropagation()}
            ref={attachCard}
            {...dialogProps}
            /* flex column + .modal-card: the card is capped to the visible
               viewport and splits into a fixed header, a scrolling middle,
               and a fixed action row, so a long description scrolls inside
               the card instead of growing it past the screen. Matches the
               shape the pool manager already uses. */
            className="modal-card relative flex w-full max-w-sm flex-col overflow-hidden rounded-2xl border border-border bg-gradient-to-b from-surface to-background text-left shadow-2xl"
          >
            {/* Soft role-colored glow behind the header — the "lighter"
                treatment instead of a flat gray panel. */}
            <div
              aria-hidden
              className={cn(
                "pointer-events-none absolute -top-16 left-1/2 h-40 w-64 -translate-x-1/2 rounded-full blur-3xl",
                roleColor.glow,
              )}
            />

            <div className="relative shrink-0 px-6 pt-6 pb-4">
              <button
                type="button"
                onClick={onClose}
                aria-label={t({ ru: "Закрыть", en: "Close" })}
                className="absolute top-4 right-4 flex size-7 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
              >
                <X className="size-4" />
              </button>

              <div className="flex items-center gap-3 pr-8">
                <span
                  className={cn(
                    "relative shrink-0 rounded-xl ring-2 ring-offset-2 ring-offset-surface",
                    roleColor.ring,
                  )}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- next/image ignores basePath for unoptimized runtime src, see lib/asset-path.ts */}
                  <img
                    src={withBasePath(perk.icon)}
                    alt={perk.name[language]}
                    width={56}
                    height={56}
                    className="size-14 rounded-xl icon-art object-cover"
                  />
                </span>
                <div>
                  <p className="font-semibold text-foreground">
                    {perk.name[language]}
                  </p>
                  <p className="flex items-center gap-1.5 text-xs">
                    <span className={cn("font-medium", roleColor.text)}>
                      {perk.role === "survivor"
                        ? t({ ru: "Выживший", en: "Survivor" })
                        : t({ ru: "Убийца", en: "Killer" })}
                    </span>
                    <span className="text-muted">
                      · {getCharacterName(perk.character, language)}
                    </span>
                  </p>
                </div>
              </div>
            </div>

            {/* min-h-0 is what actually makes this scroll: a flex child
                defaults to min-height:auto, which refuses to shrink below
                its content and would push the card past its max-height
                instead of overflowing inside it. */}
            <div className="modal-scroll relative min-h-0 flex-1 px-6">
              {portrait && (
                <div className="flex items-center gap-3 rounded-xl border border-border bg-surface/60 p-3">
                  <span
                    className={cn(
                      "relative shrink-0 overflow-hidden rounded-full ring-2 ring-offset-2 ring-offset-surface",
                      roleColor.ring,
                    )}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- next/image ignores basePath for unoptimized runtime src, see lib/asset-path.ts */}
                    <img
                      src={withBasePath(portrait)}
                      alt={getCharacterName(perk.character, language)}
                      width={48}
                      height={48}
                      className="size-12 object-cover"
                    />
                  </span>
                  <div>
                    <p className="text-[11px] text-muted">
                      {t({ ru: "Персонаж", en: "Character" })}
                    </p>
                    <p className="text-sm font-medium text-foreground">
                      {getCharacterName(perk.character, language)}
                    </p>
                  </div>
                </div>
              )}

              <PerkDescriptionPanel key={perk.slug} perk={perk} language={language} />
              {/* Bottom breathing room lives on the scroll region, not as a
                  margin on the last child — a margin there collapses out of
                  the scroll height and the final line sits flush against
                  the action row. */}
              <div className="h-6" aria-hidden />
            </div>

            {/* Stays put while the body scrolls: on a short screen this is
                the one control that must never be the thing scrolled off. */}
            <div className="relative shrink-0 border-t border-border/60 bg-background/80 px-6 py-4 backdrop-blur-sm">
              <button
                type="button"
                onClick={() => onCopy(perk)}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-border py-2 text-sm font-medium text-muted transition-colors hover:border-accent/50 hover:bg-accent/10 hover:text-accent"
              >
                <Copy className="size-3.5" />
                {t({ ru: "Копировать", en: "Copy" })}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

type DescriptionTab = "core" | "full";

/** Holds the modal's height steady for the moment before the description
 *  bundle lands, so the card doesn't jump once text arrives. Shared by the
 *  perk and loadout panels via their own copies — they render different
 *  shapes around it but want the same placeholder. */
export function DescriptionSkeleton() {
  return (
    <div className="mt-4 space-y-2" aria-hidden>
      <div className="h-6 w-40 animate-pulse rounded-full bg-surface" />
      <div className="h-3.5 w-full animate-pulse rounded bg-surface" />
      <div className="h-3.5 w-11/12 animate-pulse rounded bg-surface" />
      <div className="h-3.5 w-4/6 animate-pulse rounded bg-surface" />
    </div>
  );
}

/** Mirrors the game's own "core effect vs full text" description toggle.
 *  Keyed by perk.slug from the caller so switching perks resets the tab. */
function PerkDescriptionPanel({
  perk,
  language,
}: {
  perk: Perk;
  language: "en" | "ru";
}) {
  const t = useT();
  const [tab, setTab] = useState<DescriptionTab>("core");
  // Description text isn't part of the shipped perk list — it loads on
  // demand (see lib/descriptions.ts). Asking for it here is what starts
  // the load; in practice the bundle has usually been warmed on idle
  // before anyone opens a card, so this placeholder is a frame rather
  // than a wait.
  const entry = useDescription("perks", perk.slug);

  if (!entry) return <DescriptionSkeleton />;
  const description = getPerkDescription(entry, language);

  return (
    <div className="mt-4">
      <div className="inline-flex rounded-full border border-border bg-surface/60 p-0.5 text-xs font-medium">
        {(["core", "full"] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setTab(option)}
            className={cn(
              "rounded-full px-3 py-1 transition-colors",
              tab === option
                ? "bg-accent text-accent-foreground"
                : "text-muted hover:text-foreground",
            )}
          >
            {option === "core"
              ? t({ ru: "Кратко", en: "Core Effect" })
              : t({ ru: "Подробно", en: "Full Text" })}
          </button>
        ))}
      </div>

      {tab === "core" ? (
        <ul className="mt-3 space-y-1.5 text-sm leading-relaxed text-muted">
          {description.core.map((bullet, i) => (
            <li key={i} className="flex gap-2">
              <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-accent" aria-hidden />
              <span>
                <Highlighted text={bullet} role={perk.role} />
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-3 space-y-3">
          <p className="text-sm leading-relaxed text-muted">
            <Highlighted text={description.full} role={perk.role} />
          </p>
          {description.quote && (
            <p className="border-l-2 border-accent/40 pl-3 text-xs italic leading-relaxed text-muted/80">
              {description.quote}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
