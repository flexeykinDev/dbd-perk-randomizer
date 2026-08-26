"use client";

import {
  BarChart3,
  BookOpen,
  CalendarClock,
  History,
  ListFilter,
  MonitorPlay,
  X,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n";
import type { BuildMode } from "@/lib/types";
import type { SeedController } from "@/lib/use-seed";
import { DailyCount } from "./daily-count";
import { MoreMenu } from "./more-menu";

/* The utility bar under the build.
 *
 * Only the controls used on nearly every roll (pool, OBS) stay always
 * visible; Daily Challenge, custom seed, Stats, History and Presets moved
 * into the "More" popover, since they are reached far less often and were
 * crowding the row (user feedback: "too much buttons").
 *
 * Lifted out of RandomizerBoard's render, where it was the single largest
 * block. It holds no state of its own — the seed controller is passed in
 * whole because every control in the popover's top half is one of its verbs.
 */

const PILL =
  "tap flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium text-muted transition-colors hover:bg-surface-hover hover:text-foreground";
const MENU_ITEM =
  "tap flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm font-medium text-foreground transition-colors hover:bg-surface-hover";

/** A pool button, with the count of what has been ruled out of it. */
function PoolButton({
  label,
  excluded,
  onClick,
}: {
  label: string;
  excluded: number;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} className={PILL}>
      <ListFilter className="size-3.5" />
      {label}
      {excluded > 0 && (
        <span className="rounded-full bg-accent/15 px-1.5 text-accent">{excluded}</span>
      )}
    </button>
  );
}

export function BoardToolbar({
  mode,
  excludedPerkCount,
  excludedLoadoutCount,
  seed,
  onOpenPool,
  onOpenObs,
  onOpenStats,
  onOpenHistory,
  onOpenPresets,
}: {
  mode: BuildMode;
  excludedPerkCount: number;
  excludedLoadoutCount: number;
  seed: SeedController;
  onOpenPool: (kind: "perks" | "loadout") => void;
  onOpenObs: () => void;
  onOpenStats: () => void;
  onOpenHistory: () => void;
  onOpenPresets: () => void;
}) {
  const t = useT();
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="flex flex-wrap items-center justify-center gap-1.5 rounded-full border border-border bg-surface/60 px-2 py-1.5">
        {/* "all" mode shows perks and loadout together, so it needs a button
            for each pool; every other mode has only one to manage. */}
        {mode === "all" ? (
          <>
            <PoolButton
              label={t({ ru: "Пул перков", en: "Perk pool" })}
              excluded={excludedPerkCount}
              onClick={() => onOpenPool("perks")}
            />
            <PoolButton
              label={t({ ru: "Пул экип.", en: "Loadout pool" })}
              excluded={excludedLoadoutCount}
              onClick={() => onOpenPool("loadout")}
            />
          </>
        ) : (
          <PoolButton
            label={t({ ru: "Пул", en: "Pool" })}
            excluded={mode === "perks" ? excludedPerkCount : excludedLoadoutCount}
            onClick={() => onOpenPool(mode === "perks" ? "perks" : "loadout")}
          />
        )}
        <button
          type="button"
          onClick={onOpenObs}
          title={t({
            ru: "Отдельная ссылка специально для источника «Браузер» в OBS — не та же ссылка, что у кнопки «Поделиться».",
            en: "A separate link made specifically for an OBS Browser source — not the same link as the “Share” button.",
          })}
          className={PILL}
        >
          <MonitorPlay className="size-3.5" />
          {t({ ru: "Оверлей OBS", en: "OBS Overlay" })}
        </button>
        <span className="mx-0.5 h-4 w-px bg-border" aria-hidden />
        <MoreMenu>
          <div className="flex flex-col gap-1">
            <button
              type="button"
              onClick={seed.toggleDaily}
              className={cn(
                "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm font-medium transition-colors",
                seed.mode === "daily"
                  ? "bg-accent/15 text-accent"
                  : "text-foreground hover:bg-surface-hover",
              )}
            >
              <CalendarClock className="size-4 shrink-0" />
              {t({ ru: "Задание дня", en: "Daily Challenge" })}
            </button>

            <div className="flex items-center gap-1.5 px-2 py-1">
              <input
                type="text"
                value={seed.input}
                onChange={(e) => seed.setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && seed.applyCustom()}
                aria-label={t({ ru: "Свой сид", en: "Custom seed" })}
                placeholder={t({ ru: "Свой сид…", en: "Custom seed…" })}
                className="min-w-0 flex-1 rounded-full border border-border bg-background px-3 py-1 text-xs text-foreground placeholder:text-muted/60 focus:ring-2 focus:ring-accent/40 focus:outline-none"
              />
              <button
                type="button"
                onClick={seed.applyCustom}
                disabled={!seed.input.trim()}
                className="rounded-full px-2.5 py-1 text-xs font-medium text-muted transition-colors hover:bg-surface-hover hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
              >
                {t({ ru: "Задать", en: "Set" })}
              </button>
              {seed.mode !== "none" && (
                <button
                  type="button"
                  onClick={seed.clear}
                  aria-label={t({ ru: "Сбросить сид", en: "Clear seed" })}
                  className="flex size-6 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>

            <div className="my-1 h-px bg-border" aria-hidden />

            <button type="button" onClick={onOpenStats} className={MENU_ITEM}>
              <BarChart3 className="size-4 shrink-0" />
              {t({ ru: "Статистика", en: "Stats" })}
            </button>
            <button type="button" onClick={onOpenHistory} className={MENU_ITEM}>
              <History className="size-4 shrink-0" />
              {t({ ru: "История", en: "History" })}
            </button>
            {/* Hidden in loadout-only mode: presets are perk builds, and an
                entry that opens a picker with nothing to apply is worse than
                no entry. */}
            {mode !== "loadout" && (
              <button type="button" onClick={onOpenPresets} className={MENU_ITEM}>
                <BookOpen className="size-4 shrink-0" />
                {t({ ru: "Готовые билды", en: "Preset Builds" })}
              </button>
            )}
          </div>
        </MoreMenu>
      </div>
      {seed.active && (
        <p className="text-xs text-muted">
          {t({ ru: "Активный сид:", en: "Active seed:" })}{" "}
          <code className="rounded bg-surface px-1.5 py-0.5 text-accent">{seed.active}</code>
          {/* Daily Challenge only: a custom seed is yours alone, so a shared
              count would mean nothing there. Mounting this is also what opens
              the listener — see the component. */}
          {seed.mode === "daily" && <DailyCount />}
        </p>
      )}
    </div>
  );
}
