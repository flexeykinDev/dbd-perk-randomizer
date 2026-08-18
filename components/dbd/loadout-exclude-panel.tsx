"use client";

import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, RotateCcw, Search, Lock, CheckCheck, Ban } from "lucide-react";
import type { ItemType, LoadoutPiece, PerkRole } from "@/lib/types";
import { getLoadoutPoolForRole, ITEM_TYPE_LABEL } from "@/lib/loadout";
import { withBasePath } from "@/lib/asset-path";
import { cn } from "@/lib/cn";
import { ROLE_COLOR } from "@/lib/role-color";
import { getCharacterName } from "@/lib/character-name";
import { useT } from "@/lib/i18n";

type StatusFilter = "all" | "active" | "disabled";

const KIND_LABEL: Record<LoadoutPiece["kind"], { ru: string; en: string }> = {
  item: { ru: "Предмет", en: "Item" },
  addon: { ru: "Аддон", en: "Add-on" },
  offering: { ru: "Подношение", en: "Offering" },
};

/** Offering categories come off the wiki in English (see
 *  OFFERING_CATEGORY_ROLE in scripts/scrape-loadout.ts) and are used
 *  verbatim as data keys, so they'd otherwise surface untranslated in the
 *  Russian UI. Falls through to the raw name if the wiki ever adds a
 *  category this doesn't know — an English chip beats a missing one. */
const OFFERING_CATEGORY_LABEL: Record<string, { ru: string; en: string }> = {
  "Bonus Bloodpoints": { ru: "Бонусные очки крови", en: "Bonus Bloodpoints" },
  Luck: { ru: "Удача", en: "Luck" },
  "Map Modifications": { ru: "Изменение карты", en: "Map Modifications" },
  "Memento Mori": { ru: "Мементо мори", en: "Memento Mori" },
  "Realm Selection": { ru: "Выбор области", en: "Realm Selection" },
  Shrouds: { ru: "Пелены", en: "Shrouds" },
  Wards: { ru: "Обереги", en: "Wards" },
};

/** The category chips, derived from the pieces themselves rather than a
 *  hand-kept list: "kind:*" for the three piece kinds, then a finer pass —
 *  survivor add-ons split by the item they attach to (Med-Kit add-ons and
 *  Toolbox add-ons have nothing to do with each other), and offerings by
 *  the wiki's own category. Without this the pool is one undifferentiated
 *  grid of ~100 survivor or ~800 killer entries and the only way through
 *  it is the search box.
 *
 *  Killers are deliberately NOT chips. Every other grouping here is a
 *  small closed set (3 kinds, 5 item types, 7 offering categories — 15
 *  chips at the very most), but there are 40 killers and the roster grows
 *  every Chapter, so as chips they'd bury the useful filters in a strip
 *  nobody can scan. They get a dropdown instead (see charactersFor), which
 *  writes into this same category state so the filtering stays one path. */
type Category = { id: string; label: { ru: string; en: string }; count: number };

function categoriesFor(pool: LoadoutPiece[]): Category[] {
  const counts = new Map<string, { label: { ru: string; en: string }; count: number }>();
  const bump = (id: string, label: { ru: string; en: string }) => {
    const prev = counts.get(id);
    if (prev) prev.count++;
    else counts.set(id, { label, count: 1 });
  };

  for (const piece of pool) {
    bump(`kind:${piece.kind}`, KIND_LABEL[piece.kind]);
    if (piece.kind === "item") {
      bump(`item:${piece.itemType}`, ITEM_TYPE_LABEL[piece.itemType]);
    } else if (piece.kind === "addon" && piece.itemType) {
      bump(`item:${piece.itemType}`, ITEM_TYPE_LABEL[piece.itemType]);
    } else if (piece.kind === "offering" && piece.category) {
      bump(
        `category:${piece.category}`,
        OFFERING_CATEGORY_LABEL[piece.category] ?? {
          ru: piece.category,
          en: piece.category,
        },
      );
    }
  }

  // Kinds first in their natural loadout order, then everything else by
  // size — the biggest groups are the ones worth a click.
  const kindOrder = ["kind:item", "kind:addon", "kind:offering"];
  return [...counts.entries()]
    .map(([id, v]) => ({ id, ...v }))
    .sort((a, b) => {
      const ai = kindOrder.indexOf(a.id);
      const bi = kindOrder.indexOf(b.id);
      if (ai !== -1 || bi !== -1) {
        if (ai === -1) return 1;
        if (bi === -1) return -1;
        return ai - bi;
      }
      return b.count - a.count || a.id.localeCompare(b.id);
    });
}

/** Killers that actually own add-ons in this pool, for the dropdown. */
function charactersFor(pool: LoadoutPiece[]): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const piece of pool) {
    if (piece.kind !== "addon") continue;
    if (!piece.character || piece.character === ".All") continue;
    counts.set(piece.character, (counts.get(piece.character) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function matchesCategory(piece: LoadoutPiece, category: string): boolean {
  // Split on the FIRST colon only — a killer's name can contain one
  // ("Aestri Yazar & Baermar Uraz" doesn't, but an offering category may),
  // and a plain split() would truncate it.
  const separator = category.indexOf(":");
  const scope = category.slice(0, separator);
  const value = category.slice(separator + 1);
  if (scope === "kind") return piece.kind === value;
  if (scope === "item") {
    return (
      (piece.kind === "item" || piece.kind === "addon") &&
      (piece as { itemType?: ItemType }).itemType === value
    );
  }
  if (scope === "character") return piece.kind === "addon" && piece.character === value;
  if (scope === "category") return piece.kind === "offering" && piece.category === value;
  return true;
}

/** Manage-the-loadout-pool panel — same job as ExcludePanel but for the 3
 *  Full Loadout piece kinds at once, keyed "kind:slug" (see lib/loadout.ts). */
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
  const [category, setCategory] = useState<string>("all");

  const poolForRole = useMemo(() => getLoadoutPoolForRole(role, character), [role, character]);
  const roleColor = ROLE_COLOR[role];
  const categories = useMemo(() => categoriesFor(poolForRole), [poolForRole]);
  const characters = useMemo(() => charactersFor(poolForRole), [poolForRole]);
  // Switching role, or picking a killer, rebuilds the pool and can retire
  // the chip that was selected (a Med-Kit filter means nothing on the
  // killer side). Falling back to "all" when the selection no longer
  // exists self-heals that without an effect that could flash the old
  // filter for a frame first.
  const activeCategory =
    category !== "all" &&
    (categories.some((c) => c.id === category) ||
      characters.some((c) => `character:${c.name}` === category))
      ? category
      : "all";
  const selectedCharacter = activeCategory.startsWith("character:")
    ? activeCategory.slice("character:".length)
    : "";

  const keyOf = (piece: LoadoutPiece) => `${piece.kind}:${piece.slug}`;
  const activeCount = poolForRole.filter((p) => !excludedKeys.has(keyOf(p))).length;

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return poolForRole.filter((piece) => {
      const key = keyOf(piece);
      if (status === "active" && excludedKeys.has(key)) return false;
      if (status === "disabled" && !excludedKeys.has(key)) return false;
      if (activeCategory !== "all" && !matchesCategory(piece, activeCategory)) return false;
      if (query) {
        const haystack = `${piece.name.en} ${piece.name.ru}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
  }, [poolForRole, status, activeCategory, search, excludedKeys]);

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
            className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl lg:max-w-4xl"
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

                {/* Bounded chips only — 15 at the very most, so they wrap
                    cleanly. The 40-strong killer roster lives in the
                    dropdown below instead. */}
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setCategory("all")}
                    className={cn(
                      "rounded-full border px-3 py-1 text-[11px] font-medium transition-colors",
                      activeCategory === "all"
                        ? cn(roleColor.border, roleColor.bg, roleColor.text)
                        : "border-border text-muted hover:bg-surface-hover hover:text-foreground",
                    )}
                  >
                    {t({ ru: "Все", en: "All" })}
                    <span className="ml-1.5 opacity-60">{poolForRole.length}</span>
                  </button>
                  {categories.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setCategory(c.id)}
                      className={cn(
                        "rounded-full border px-3 py-1 text-[11px] font-medium transition-colors",
                        activeCategory === c.id
                          ? cn(roleColor.border, roleColor.bg, roleColor.text)
                          : "border-border text-muted hover:bg-surface-hover hover:text-foreground",
                      )}
                    >
                      {t(c.label)}
                      <span className="ml-1.5 opacity-60">{c.count}</span>
                    </button>
                  ))}

                  {/* The killer roster — a dropdown rather than 40 more
                      chips. Writes the same "character:<name>" id the chips
                      use, so there's still exactly one selected filter and
                      one filtering path. */}
                  {characters.length > 0 && (
                    <select
                      value={selectedCharacter}
                      onChange={(e) =>
                        setCategory(e.target.value ? `character:${e.target.value}` : "all")
                      }
                      aria-label={t({ ru: "Фильтр по персонажу", en: "Filter by character" })}
                      className={cn(
                        "rounded-full border px-3 py-1 text-[11px] font-medium transition-colors focus:ring-2 focus:ring-accent/40 focus:outline-none",
                        selectedCharacter
                          ? cn(roleColor.border, roleColor.bg, roleColor.text)
                          : "border-border bg-transparent text-muted hover:bg-surface-hover hover:text-foreground",
                      )}
                    >
                      <option value="">{t({ ru: "Персонаж…", en: "Character…" })}</option>
                      {characters.map((c) => (
                        <option key={c.name} value={c.name}>
                          {getCharacterName(c.name, language)} ({c.count})
                        </option>
                      ))}
                    </select>
                  )}
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
                <div className="grid grid-cols-3 gap-2 p-4 sm:grid-cols-4 lg:grid-cols-6">
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
                          className="mt-2 size-12 rounded-lg icon-art object-cover"
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
