"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Clock, RotateCcw, Trash2, X } from "lucide-react";
import type { LoadoutPiece, Perk } from "@/lib/types";
import { withBasePath } from "@/lib/asset-path";
import { clearHistory, getHistory, parseLoadoutKey, type HistoryEntry } from "@/lib/history";
import { getPerkBySlug } from "@/lib/perks";
import { getLoadoutPiece } from "@/lib/loadout";
import { ROLE_COLOR } from "@/lib/role-color";
import { cn } from "@/lib/cn";
import { useT, ruPlural, type Lang } from "@/lib/i18n";
import { useModal } from "@/lib/use-modal";
import { ConfirmDialog } from "./confirm-dialog";

/** Resolves a history entry's plain slug/key strings back to the actual
 *  Perk/LoadoutPiece objects it needs to render — history only ever
 *  stores the lightweight keys (see lib/history.ts), same reasoning as
 *  the URL share scheme, so this is the one place that does the lookup. */
function resolvePieces(entry: HistoryEntry): (Perk | LoadoutPiece)[] {
  if (entry.mode === "perks") {
    return entry.keys.map((slug) => getPerkBySlug(slug)).filter((p): p is Perk => !!p);
  }
  return entry.keys
    .map((key) => {
      const parsed = parseLoadoutKey(key);
      return parsed ? getLoadoutPiece(parsed.kind, parsed.slug) : undefined;
    })
    .filter((p): p is LoadoutPiece => !!p);
}

function formatRelativeTime(at: number, lang: Lang): string {
  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (seconds < 30) return lang === "ru" ? "только что" : "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return lang === "ru"
      ? `${minutes} ${ruPlural(minutes, "минуту", "минуты", "минут")} назад`
      : `${minutes} min ago`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return lang === "ru" ? `${hours} ${ruPlural(hours, "час", "часа", "часов")} назад` : `${hours}h ago`;
  }
  const days = Math.round(hours / 24);
  return lang === "ru" ? `${days} ${ruPlural(days, "день", "дня", "дней")} назад` : `${days}d ago`;
}

/** Recently rolled builds (both Perks and Loadout), newest first — lets a
 *  player jump back to a build they liked without needing Battle Royale
 *  or a screenshot. Reuses the same "shared build" display path a Share
 *  link or a Twitch !paste already uses (see randomizer-board.tsx's
 *  restoreHistoryEntry), so viewing a past roll is exactly as safe as
 *  viewing someone else's — it doesn't touch the actual random pool. */
export function HistoryModal({
  open,
  language,
  onClose,
  onRestore,
  version,
}: {
  open: boolean;
  language: "en" | "ru";
  onClose: () => void;
  onRestore: (entry: HistoryEntry) => void;
  /** Bump to force a re-read of localStorage the next time this is open
   *  (e.g. right after a new build was generated) — same pattern as
   *  StatsModal's version prop, fed by the same roll-recording effects. */
  version: number;
}) {
  const t = useT();
  const { attachCard, dialogProps } = useModal({
    open,
    onClose,
    label: t({ ru: "История билдов", en: "Build history" }),
  });
  const [confirmOpen, setConfirmOpen] = useState(false);

  void version;
  const history = open ? getHistory() : [];

  return (
    <>
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
              className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl"
            >
              <div className="flex items-center justify-between gap-3 border-b border-border p-4">
                <div>
                  <p className="font-semibold text-foreground">
                    {t({ ru: "История билдов", en: "Build History" })}
                  </p>
                  <p className="text-xs text-muted">
                    {t({
                      ru: "Последние 20 роллов, хранится локально в этом браузере",
                      en: "Last 20 rolls, stored locally in this browser",
                    })}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirmOpen(true)}
                    disabled={history.length === 0}
                    className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:border-rose-500/40 hover:text-rose-400 disabled:pointer-events-none disabled:opacity-40"
                  >
                    <Trash2 className="size-3.5" />
                    {t({ ru: "Очистить", en: "Clear" })}
                  </button>
                  <button
                    type="button"
                    onClick={onClose}
                    aria-label={t({ ru: "Закрыть", en: "Close" })}
                    className="flex size-8 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
                  >
                    <X className="size-4" />
                  </button>
                </div>
              </div>

              <div className="overflow-y-auto p-4">
                {history.length === 0 ? (
                  <p className="py-10 text-center text-sm text-muted">
                    {t({
                      ru: "Пока пусто — сгенерируйте билд, и он появится здесь.",
                      en: "Nothing yet — generate a build and it'll show up here.",
                    })}
                  </p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {history.map((entry) => {
                      const pieces = resolvePieces(entry);
                      if (pieces.length === 0) return null; // stale slugs from a since-retired perk/piece
                      const roleColor = ROLE_COLOR[entry.role];
                      return (
                        <li
                          key={entry.id}
                          className="flex items-center gap-3 rounded-xl border border-border bg-background/60 p-2.5"
                        >
                          <div className="flex shrink-0 -space-x-2">
                            {pieces.slice(0, 4).map((piece, i) => (
                              // eslint-disable-next-line @next/next/no-img-element -- next/image ignores basePath for unoptimized runtime src, see lib/asset-path.ts
                              <img
                                key={`${entry.id}-${i}`}
                                src={withBasePath(piece.icon)}
                                alt=""
                                aria-hidden
                                width={32}
                                height={32}
                                className="size-8 rounded-lg border-2 border-surface icon-art object-cover"
                                style={{ zIndex: 4 - i }}
                              />
                            ))}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="flex items-center gap-1.5 text-xs">
                              <span className={cn("font-medium", roleColor.text)}>
                                {entry.role === "survivor"
                                  ? t({ ru: "Выживший", en: "Survivor" })
                                  : t({ ru: "Убийца", en: "Killer" })}
                              </span>
                              <span className="text-muted">
                                · {entry.mode === "loadout" ? t({ ru: "Экипировка", en: "Loadout" }) : t({ ru: "Перки", en: "Perks" })}
                              </span>
                            </p>
                            <p className="truncate text-xs text-muted/80">
                              {pieces.map((p) => p.name[language]).join(", ")}
                            </p>
                          </div>
                          <div className="flex shrink-0 flex-col items-end gap-1">
                            <span className="flex items-center gap-1 text-[10px] text-muted/70">
                              <Clock className="size-2.5" />
                              {formatRelativeTime(entry.at, language)}
                            </span>
                            <button
                              type="button"
                              onClick={() => onRestore(entry)}
                              className="flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-muted transition-colors hover:border-accent/50 hover:bg-accent/10 hover:text-accent"
                            >
                              <RotateCcw className="size-2.5" />
                              {t({ ru: "Открыть", en: "View" })}
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <ConfirmDialog
        open={confirmOpen}
        title={t({ ru: "Очистить историю?", en: "Clear history?" })}
        message={t({
          ru: "Вся локальная история билдов будет удалена без возможности восстановления.",
          en: "All locally stored build history will be permanently deleted.",
        })}
        confirmLabel={t({ ru: "Очистить", en: "Clear" })}
        cancelLabel={t({ ru: "Отмена", en: "Cancel" })}
        danger
        onConfirm={() => {
          clearHistory();
          setConfirmOpen(false);
        }}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
}
