"use client";

import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { getBuildPresets, resolvePreset, type BuildPreset } from "@/lib/build-presets";
import { withBasePath } from "@/lib/asset-path";
import { ROLE_COLOR } from "@/lib/role-color";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n";
import { useModal } from "@/lib/use-modal";
import type { PerkRole } from "@/lib/types";

/** Hand-picked builds, offered as an entry point for players who don't yet
 *  know which perks go together — the randomizer's answer to "I have 300
 *  perks and no idea what any of them do".
 *
 *  Applying one goes through the same "shared build" path a Share link or
 *  a Twitch !paste already uses, so a preset is displayed exactly the way
 *  someone else's build is: shown as-is, and left alone until you roll.
 *  That's also why the padlocks and per-slot rerolls disappear while one is
 *  open — like any fixed build, there is nothing here to reroll around.
 *  Pressing Generate replaces it with a fresh random build, which is the
 *  intended way out: a preset is a starting point, not a mode. */
export function PresetsModal({
  open,
  role,
  language,
  onClose,
  onApply,
}: {
  open: boolean;
  /** Which role's presets to show. The picker follows the board rather
   *  than offering both at once — applying a killer build from survivor
   *  mode would silently switch the whole page under the player. */
  role: PerkRole;
  language: "en" | "ru";
  onClose: () => void;
  onApply: (preset: BuildPreset) => void;
}) {
  const t = useT();
  const { attachCard, dialogProps } = useModal({
    open,
    onClose,
    label: t({ ru: "Готовые билды", en: "Preset Builds" }),
  });

  const presets = getBuildPresets(role);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0, pointerEvents: "none" }}
          animate={{ opacity: 1, pointerEvents: "auto" }}
          exit={{ opacity: 0, pointerEvents: "none" }}
          onClick={onClose}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 10 }}
            transition={{ type: "spring", stiffness: 400, damping: 34 }}
            onClick={(e) => e.stopPropagation()}
            ref={attachCard}
            {...dialogProps}
            className="modal-card flex w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl"
          >
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border p-4">
              <div>
                <p className="font-semibold text-foreground">
                  {t({ ru: "Готовые билды", en: "Preset Builds" })}
                </p>
                <p className="text-xs text-muted">
                  {t({
                    ru: "Собранные наборы — как отправная точка, а не как режим",
                    en: "Assembled sets, as a starting point rather than a mode",
                  })}
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label={t({ ru: "Закрыть", en: "Close" })}
                className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="modal-scroll min-h-0 flex-1 space-y-2 p-4">
              {presets.map((preset) => {
                const perks = resolvePreset(preset);
                const roleColor = ROLE_COLOR[preset.role];
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => {
                      onApply(preset);
                      onClose();
                    }}
                    className={cn(
                      "w-full rounded-xl border border-border bg-background p-3 text-left transition-colors hover:bg-surface-hover",
                      roleColor.hoverBorder,
                    )}
                  >
                    <p className="text-sm font-semibold text-foreground">
                      {preset.name[language]}
                    </p>
                    <p className="mt-0.5 text-xs text-muted">{preset.description[language]}</p>
                    <div className="mt-2.5 flex items-center gap-2">
                      {perks.map((perk) => (
                        <span key={perk.slug} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                          {/* eslint-disable-next-line @next/next/no-img-element -- next/image ignores basePath for unoptimized runtime src, see lib/asset-path.ts */}
                          <img
                            src={withBasePath(perk.icon)}
                            alt=""
                            width={48}
                            height={48}
                            className="icon-art size-11 rounded-lg object-cover"
                          />
                          <span className="w-full truncate text-center text-[10px] leading-tight text-muted">
                            {perk.name[language]}
                          </span>
                        </span>
                      ))}
                    </div>
                  </button>
                );
              })}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
