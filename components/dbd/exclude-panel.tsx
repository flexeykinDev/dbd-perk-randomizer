"use client";

import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  RotateCcw,
  Search,
  Lock,
  CheckCheck,
  Ban,
  ArrowUpNarrowWide,
  ArrowDownWideNarrow,
  Star,
} from "lucide-react";
import type { PerkRole } from "@/lib/types";
import { getPerksByRole } from "@/lib/perks";
import { withBasePath } from "@/lib/asset-path";
import { cn } from "@/lib/cn";
import { ROLE_COLOR } from "@/lib/role-color";
import { useT } from "@/lib/i18n";
import { getCharacterName } from "@/lib/character-name";
import { getTagsForPerk, getTagsForRole } from "@/lib/perk-tags";

type StatusFilter = "all" | "active" | "disabled" | "favorite";
type SortField = "name" | "character" | "date";
type SortDir = "asc" | "desc";

export function ExcludePanel({
  open,
  role,
  language,
  excludedSlugs,
  alsoGrayedOut,
  favoriteSlugs,
  onToggle,
  onBulkSet,
  onToggleFavorite,
  onResetRole,
  onClose,
}: {
  open: boolean;
  role: PerkRole;
  language: "en" | "ru";
  excludedSlugs: Set<string>;
  /** Perks that read as unavailable for another reason (e.g. eliminated in
   *  Battle Royale) — shown with the same grayed-out treatment, just not
   *  counted in the "N excluded" badge or cleared by "Сбросить". */
  alsoGrayedOut?: ReadonlySet<string>;
  /** Favorited perks get boosted odds in getRandomPerks (see lib/perks.ts)
   *  instead of being force-included — a perk can be both favorited and
   *  excluded at once (exclusion always wins, it's just never drawn), so
   *  the two sets are intentionally independent. */
  favoriteSlugs: Set<string>;
  onToggle: (slug: string) => void;
  onBulkSet: (slugs: string[], excluded: boolean) => void;
  onToggleFavorite: (slug: string) => void;
  onResetRole: (role: PerkRole) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [search, setSearch] = useState("");
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<StatusFilter>("all");
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const perksForRole = useMemo(() => getPerksByRole(role), [role]);
  const roleColor = ROLE_COLOR[role];
  const tags = getTagsForRole(role);

  const activeCount = perksForRole.filter((p) => !excludedSlugs.has(p.slug)).length;

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    let list = perksForRole.filter((perk) => {
      if (status === "active" && excludedSlugs.has(perk.slug)) return false;
      if (status === "disabled" && !excludedSlugs.has(perk.slug)) return false;
      if (status === "favorite" && !favoriteSlugs.has(perk.slug)) return false;
      if (selectedTags.size > 0) {
        const perkTags = getTagsForPerk(perk);
        if (!perkTags.some((tag) => selectedTags.has(tag))) return false;
      }
      if (query) {
        const haystack = `${perk.name.en} ${perk.name.ru}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });

    list = [...list];
    switch (sortField) {
      case "name":
        list.sort((a, b) => a.name[language].localeCompare(b.name[language], language));
        break;
      case "character":
        list.sort(
          (a, b) =>
            getCharacterName(a.character, language).localeCompare(
              getCharacterName(b.character, language),
              language,
            ) || a.name[language].localeCompare(b.name[language], language),
        );
        break;
      case "date":
        list.sort((a, b) => new Date(a.addedAt).getTime() - new Date(b.addedAt).getTime());
        break;
    }
    if (sortDir === "desc") list.reverse();
    return list;
  }, [
    perksForRole,
    status,
    selectedTags,
    search,
    sortField,
    sortDir,
    excludedSlugs,
    favoriteSlugs,
    language,
  ]);

  // addedAt is "date the scraper first saw this slug", not the perk's real
  // DBD release date — carried forward on every rescrape (see
  // scripts/scrape-perks.ts). Right now every perk shares the exact same
  // bulk-import timestamp, so the Date sort is a no-op; it starts working
  // the moment a future scrape adds a genuinely new perk. Surface that
  // honestly instead of pretending the sort is doing something today.
  const dateSortIsCurrentlyMeaningless = useMemo(
    () => new Set(perksForRole.map((p) => p.addedAt)).size <= 1,
    [perksForRole],
  );

  function toggleTag(tagId: string) {
    setSelectedTags((prev) => {
      const next = new Set(prev);
      if (next.has(tagId)) next.delete(tagId);
      else next.add(tagId);
      return next;
    });
  }

  const filteredSlugs = filtered.map((p) => p.slug);

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
                  {t({ ru: "Настроить пул перков", en: "Manage the perk pool" })}
                </p>
                <p className="text-xs text-muted">
                  {t({ ru: "Активно:", en: "Active:" })}{" "}
                  <b className={roleColor.text}>{activeCount}</b> / {perksForRole.length}
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
                  <select
                    value={sortField}
                    onChange={(e) => setSortField(e.target.value as SortField)}
                    className="rounded-full border border-border bg-background px-3 py-1.5 text-xs text-foreground focus:ring-2 focus:ring-accent/40 focus:outline-none"
                  >
                    <option value="name">{t({ ru: "По названию", en: "By Name" })}</option>
                    <option value="character">{t({ ru: "По персонажу", en: "By Character" })}</option>
                    <option value="date">{t({ ru: "По дате добавления", en: "By Date Added" })}</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
                    aria-label={
                      sortDir === "asc"
                        ? t({ ru: "По возрастанию", en: "Ascending" })
                        : t({ ru: "По убыванию", en: "Descending" })
                    }
                    title={
                      sortDir === "asc"
                        ? t({ ru: "По возрастанию — нажмите, чтобы сменить", en: "Ascending — click to flip" })
                        : t({ ru: "По убыванию — нажмите, чтобы сменить", en: "Descending — click to flip" })
                    }
                    className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
                  >
                    {sortDir === "asc" ? (
                      <ArrowUpNarrowWide className="size-3.5" />
                    ) : (
                      <ArrowDownWideNarrow className="size-3.5" />
                    )}
                  </button>
                </div>
                {sortField === "date" && dateSortIsCurrentlyMeaningless && (
                  <p className="text-[11px] text-muted/70">
                    {t({
                      ru: "Пока не сортирует — у всех перков одна и та же дата первого добавления в базу сайта. Заработает, когда скрапер найдёт новый перк.",
                      en: "Doesn't reorder anything yet — every perk currently shares the same first-added-to-the-site date. Starts working once the scraper picks up a genuinely new perk.",
                    })}
                  </p>
                )}

                <div className="flex flex-wrap items-center gap-1.5">
                  {(["all", "active", "disabled", "favorite"] as const).map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setStatus(option)}
                      className={cn(
                        "flex items-center gap-1 rounded-full border px-3 py-1 text-[11px] font-medium transition-colors",
                        status === option
                          ? cn(roleColor.border, roleColor.bg, roleColor.text)
                          : "border-border text-muted hover:bg-surface-hover hover:text-foreground",
                      )}
                    >
                      {option === "favorite" && <Star className="size-2.5" />}
                      {option === "all"
                        ? t({ ru: "Все", en: "All" })
                        : option === "active"
                          ? t({ ru: "Активные", en: "Active" })
                          : option === "disabled"
                            ? t({ ru: "Отключённые", en: "Disabled" })
                            : t({ ru: "Избранные", en: "Favorites" })}
                    </button>
                  ))}
                  <span className="mx-1 h-4 w-px bg-border" aria-hidden />
                  {tags.map((tag) => (
                    <button
                      key={tag.id}
                      type="button"
                      onClick={() => toggleTag(tag.id)}
                      className={cn(
                        "rounded-full border px-3 py-1 text-[11px] font-medium transition-colors",
                        selectedTags.has(tag.id)
                          ? "border-accent/50 bg-accent/15 text-accent"
                          : "border-border text-muted hover:bg-surface-hover hover:text-foreground",
                      )}
                    >
                      {t({ ru: tag.ru, en: tag.en })}
                    </button>
                  ))}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onBulkSet(filteredSlugs, false)}
                    disabled={filteredSlugs.length === 0}
                    className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-[11px] font-medium text-muted transition-colors hover:bg-surface-hover hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
                  >
                    <CheckCheck className="size-3.5" />
                    {t({ ru: "Включить все", en: "Enable All" })}
                  </button>
                  <button
                    type="button"
                    onClick={() => onBulkSet(filteredSlugs, true)}
                    disabled={filteredSlugs.length === 0}
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
                  {filtered.map((perk) => {
                    const excluded = excludedSlugs.has(perk.slug) || alsoGrayedOut?.has(perk.slug);
                    return (
                      // A real <button> can't contain another interactive
                      // descendant (invalid content model) — this card needs
                      // one for the star toggle below, so it's a div with an
                      // ARIA button role instead, same pattern as the perk
                      // detail card in perk-grid.tsx.
                      <div
                        key={perk.slug}
                        role="button"
                        tabIndex={0}
                        onClick={() => onToggle(perk.slug)}
                        onKeyDown={(e) => {
                          if (e.key !== "Enter" && e.key !== " ") return;
                          e.preventDefault();
                          onToggle(perk.slug);
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
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onToggleFavorite(perk.slug);
                          }}
                          aria-label={
                            favoriteSlugs.has(perk.slug)
                              ? t({ ru: "Убрать из избранного", en: "Remove from favorites" })
                              : t({ ru: "Добавить в избранное", en: "Add to favorites" })
                          }
                          className={cn(
                            "absolute top-1 left-1 flex size-4 items-center justify-center rounded-full bg-black/60 transition-colors",
                            favoriteSlugs.has(perk.slug)
                              ? "text-amber-400"
                              : "text-white/50 hover:text-white",
                          )}
                        >
                          <Star
                            className="size-2.5"
                            fill={favoriteSlugs.has(perk.slug) ? "currentColor" : "none"}
                          />
                        </button>
                        {/* eslint-disable-next-line @next/next/no-img-element -- next/image ignores basePath for unoptimized runtime src, see lib/asset-path.ts */}
                        <img
                          src={withBasePath(perk.icon)}
                          alt={perk.name[language]}
                          width={48}
                          height={48}
                          className="size-12 rounded-lg object-cover"
                        />
                        <span className="text-[10px] leading-tight text-foreground">
                          {perk.name[language]}
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
