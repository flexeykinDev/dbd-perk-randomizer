"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X, Trash2 } from "lucide-react";
import type { PerkRole } from "@/lib/types";
import { getPerksByRole } from "@/lib/perks";
import { withBasePath } from "@/lib/asset-path";
import { getRoleStatsSummary, resetStats, type PerkRollStat } from "@/lib/stats";
import { cn } from "@/lib/cn";
import { ROLE_COLOR } from "@/lib/role-color";
import { useT } from "@/lib/i18n";
import { ConfirmDialog } from "./confirm-dialog";

export function StatsModal({
  open,
  language,
  onClose,
  version,
}: {
  open: boolean;
  language: "en" | "ru";
  onClose: () => void;
  /** Bump to force a re-read of localStorage the next time this is open
   *  (e.g. right after a new build was generated). */
  version: number;
}) {
  const t = useT();
  const [role, setRole] = useState<PerkRole>("survivor");
  const [confirmOpen, setConfirmOpen] = useState(false);

  void version;
  const stats = open ? getRoleStatsSummary(role, getPerksByRole(role)) : null;
  const roleColor = ROLE_COLOR[role];

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
              className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl lg:max-w-xl"
            >
              <div className="flex items-center justify-between gap-3 border-b border-border p-4">
                <div>
                  <p className="font-semibold text-foreground">
                    {t({ ru: "Статистика роллов", en: "Roll Statistics" })}
                  </p>
                  <p className="text-xs text-muted">
                    {t({
                      ru: "Хранится локально в этом браузере",
                      en: "Stored locally in this browser",
                    })}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirmOpen(true)}
                    className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:border-rose-500/40 hover:text-rose-400"
                  >
                    <Trash2 className="size-3.5" />
                    {t({ ru: "Сбросить", en: "Reset" })}
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

              <div className="border-b border-border p-3">
                <div className="inline-flex rounded-full border border-border bg-background p-0.5 text-xs font-medium">
                  {(["survivor", "killer"] as const).map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setRole(r)}
                      className={cn(
                        "rounded-full px-3 py-1.5 transition-colors",
                        role === r
                          ? cn(ROLE_COLOR[r].bg, ROLE_COLOR[r].text)
                          : "text-muted hover:text-foreground",
                      )}
                    >
                      {r === "survivor"
                        ? t({ ru: "Выживший", en: "Survivor" })
                        : t({ ru: "Убийца", en: "Killer" })}
                    </button>
                  ))}
                </div>
              </div>

              <div className="overflow-y-auto p-4">
                {!stats || stats.totalBuilds === 0 ? (
                  <p className="py-10 text-center text-sm text-muted">
                    {t({
                      ru: "Пока нет данных — сгенерируйте несколько билдов.",
                      en: "No data yet — generate a few builds.",
                    })}
                  </p>
                ) : (
                  <div className="flex flex-col gap-5">
                    <div
                      className={cn(
                        "rounded-xl border p-3 text-center",
                        roleColor.border,
                        roleColor.bg,
                      )}
                    >
                      <p className={cn("text-2xl font-bold", roleColor.text)}>
                        {stats.totalBuilds}
                      </p>
                      <p className="text-xs text-muted">
                        {t({ ru: "билдов сгенерировано", en: "builds generated" })}
                      </p>
                    </div>

                    <StatList
                      title={t({ ru: "Чаще всего выпадают", en: "Most Frequently Rolled" })}
                      stats={stats.top}
                      language={language}
                      emptyLabel={t({ ru: "Пока пусто", en: "Nothing yet" })}
                    />
                    <StatList
                      title={t({ ru: "Реже всего выпадают", en: "Least Rolled" })}
                      stats={stats.bottom}
                      language={language}
                      emptyLabel={t({ ru: "Пока пусто", en: "Nothing yet" })}
                    />
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <ConfirmDialog
        open={confirmOpen}
        title={t({ ru: "Сбросить статистику?", en: "Reset statistics?" })}
        message={t({
          ru: "Вся локальная история роллов для обеих ролей будет удалена без возможности восстановления.",
          en: "All locally stored roll history for both roles will be permanently deleted.",
        })}
        confirmLabel={t({ ru: "Сбросить", en: "Reset" })}
        cancelLabel={t({ ru: "Отмена", en: "Cancel" })}
        danger
        onConfirm={() => {
          resetStats();
          setConfirmOpen(false);
        }}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
}

function StatList({
  title,
  stats,
  language,
  emptyLabel,
}: {
  title: string;
  stats: PerkRollStat[];
  language: "en" | "ru";
  emptyLabel: string;
}) {
  return (
    <div>
      <p className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">{title}</p>
      {stats.length === 0 ? (
        <p className="text-sm text-muted">{emptyLabel}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {stats.map(({ perk, count, percent }) => (
            <li
              key={perk.slug}
              className="flex items-center gap-2.5 rounded-lg border border-border bg-background/60 px-2.5 py-1.5"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- next/image ignores basePath for unoptimized runtime src, see lib/asset-path.ts */}
              <img
                src={withBasePath(perk.icon)}
                alt={perk.name[language]}
                width={28}
                height={28}
                className="size-7 shrink-0 rounded-md icon-art object-cover"
              />
              <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                {perk.name[language]}
              </span>
              <span className="shrink-0 text-xs text-muted">
                {count}× · {percent.toFixed(1)}%
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
