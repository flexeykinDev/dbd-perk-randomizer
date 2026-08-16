"use client";

import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, RotateCcw, Search, Lock, CheckCheck, Ban } from "lucide-react";
import type { LoadoutPiece, PerkRole } from "@/lib/types";
import { getLoadoutPoolForRole } from "@/lib/loadout";
import { withBasePath } from "@/lib/asset-path";
import { cn } from "@/lib/cn";
import { ROLE_COLOR } from "@/lib/role-color";
import { useT } from "@/lib/i18n";

type StatusFilter = "all" | "active" | "disabled";

const KIND_LABEL: Record<LoadoutPiece["kind"], { ru: string; en: string }> = {
  item: { ru: "Предмет", en: "Item" },
  addon: { ru: "Аддон", en: "Add-on" },
  offering: { ru: "Подношение", en: "Offering" },
};

/** Manage-the-loadout-pool panel — same job as ExcludePanel but for the 3
 *  Full Loadout piece kinds at once, keyed "kind:slug" (see lib/loadout.ts).
 *  Deliberately simpler than ExcludePanel (search + status filter only, no
 *  tags/sort) since loadout pieces don't have a tag taxonomy yet. */
export function LoadoutExcludePanel({
  open,
  role,
  language,
  character,
  excludedKeys,
  alsoGrayedOut,
  onToggle,
  onBulkSet,
  onResetRole,
  onClose,
}: {
  open: boolean;
  role: PerkRole;
  language: "en" | "ru";
  /** Selected killer (Feature #2's picker), if any — narrows the add-on pool
   *  to that killer's own Power add-ons, see getLoadoutPoolForRole. */
  character?: string | null;
  excludedKeys: Set<string>;
  /** Pieces that read as unavailable for another reason (e.g. eliminated in
   *  Battle Royale) — grayed out the same way, not counted or cleared by Reset. */
  alsoGrayedOut?: ReadonlySet<string>;
  onToggle: (kind: LoadoutPiece["kind"], slug: string) => void;
  onBulkSet: (keys: string[], excluded: boolean) => void;
  onResetRole: (role: PerkRole) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");

  const poolForRole = useMemo(() => getLoadoutPoolForRole(role, character), [role, character]);
  const roleColor = ROLE_COLOR[role];

  const keyOf = (piece: LoadoutPiece) => `${piece.kind}:${piece.slug}`;
  const activeCount = poolForRole.filter((p) => !excludedKeys.has(keyOf(p))).length;

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return poolForRole.filter((piece) => {
      const key = keyOf(piece);
      if (status === "active" && excludedKeys.has(key)) return false;
      if (status === "disabled" && !excludedKeys.has(key)) return false;
      if (query) {
        const haystack = `${piece.name.en} ${piece.name.ru}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
  }, [poolForRole, status, search, excludedKeys]);

  const filteredKeys = filtered.map(keyOf);

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
            className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl"
          >
            <div className="flex items-center justify-between gap-3 border-b border-border p-4">
              <div className="text-left">
                <p className="font-semibold text-foreground">
                  {t({ ru: "Настроить пул экипировки", en: "Manage the loadout pool" })}
                </p>
                <p className="text-xs text-muted">
                  {t({ ru: "Активно:", en: "Active:" })}{" "}
                  <b className={roleColor.text}>{activeCount}</b> / {poolForRole.length}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => onResetRole(role)}
                  className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
                >
                  <RotateCcw className="size-3.5" />
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

            <div className="flex-1 overflow-y-auto">
              <div className="sticky top-0 z-10 flex flex-col gap-3 border-b border-border bg-surface p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative min-w-40 flex-1">
                    <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted" />
                    <input
                      type="text"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder={t({
                        ru: "Поиск: EN или RU название…",
                        en: "Search: EN or RU name…",
                      })}
                      className="w-full rounded-full border border-border bg-background py-1.5 pr-3 pl-8 text-xs text-foreground placeholder:text-muted/60 focus:ring-2 focus:ring-accent/40 focus:outline-none"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  {(["all", "active", "disabled"] as const).map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setStatus(option)}
                      className={cn(
                        "rounded-full border px-3 py-1 text-[11px] font-medium transition-colors",
                        status === option
                          ? cn(roleColor.border, roleColor.bg, roleColor.text)
                          : "border-border text-muted hover:bg-surface-hover hover:text-foreground",
                      )}
                    >
                      {option === "all"
                        ? t({ ru: "Все", en: "All" })
                        : option === "active"
                          ? t({ ru: "Активные", en: "Active" })
                          : t({ ru: "Отключённые", en: "Disabled" })}
                    </button>
                  ))}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onBulkSet(filteredKeys, false)}
                    disabled={filteredKeys.length === 0}
                    className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-[11px] font-medium text-muted transition-colors hover:bg-surface-hover hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
                  >
                    <CheckCheck className="size-3.5" />
                    {t({ ru: "Включить все", en: "Enable All" })}
                  </button>
                  <button
                    type="button"
                    onClick={() => onBulkSet(filteredKeys, true)}
                    disabled={filteredKeys.length === 0}
                    className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-[11px] font-medium text-muted transition-colors hover:bg-surface-hover hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
                  >
                    <Ban className="size-3.5" />
                    {t({ ru: "Отключить все", en: "Disable All" })}
                  </button>
                  <span className="text-[11px] text-muted">
                    {t({ ru: "Показано:", en: "Showing:" })} {filtered.length}
                  </span>
                </div>
              </div>

              {filtered.length === 0 ? (
                <p className="p-8 text-center text-sm text-muted">
                  {t({ ru: "Ничего не найдено", en: "Nothing matches" })}
                </p>
              ) : (
                <div className="grid grid-cols-3 gap-2 p-4 sm:grid-cols-4">
                  {filtered.map((piece) => {
                    const key = keyOf(piece);
                    const excluded = excludedKeys.has(key) || alsoGrayedOut?.has(key);
                    return (
                      <div
                        key={key}
                        role="button"
                        tabIndex={0}
                        onClick={() => onToggle(piece.kind, piece.slug)}
                        onKeyDown={(e) => {
                          if (e.key !== "Enter" && e.key !== " ") return;
                          e.preventDefault();
                          onToggle(piece.kind, piece.slug);
                        }}
                        className={cn(
                          "relative flex cursor-pointer flex-col items-center gap-1 rounded-xl border p-2 text-center transition-all",
                          excluded
                            ? "border-border/40 opacity-35 grayscale"
                            : cn("border-border", roleColor.hoverBorder),
                        )}
                      >
                        {excluded && (
                          <span className="absolute top-1 right-1 flex size-4 items-center justify-center rounded-full bg-black/60 text-white">
                            <Lock className="size-2.5" />
                          </span>
                        )}
                        <span className="absolute top-1 left-1 rounded-full bg-black/60 px-1.5 py-0.5 text-[8px] font-bold text-white/90">
                          {t(KIND_LABEL[piece.kind])}
                        </span>
                        {/* eslint-disable-next-line @next/next/no-img-element -- next/image ignores basePath for unoptimized runtime src, see lib/asset-path.ts */}
                        <img
                          src={withBasePath(piece.icon)}
                          alt={piece.name[language]}
                          width={48}
                          height={48}
                          className="mt-2 size-12 rounded-lg object-cover"
                        />
                        <span className="text-[10px] leading-tight text-foreground">
                          {piece.name[language]}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
