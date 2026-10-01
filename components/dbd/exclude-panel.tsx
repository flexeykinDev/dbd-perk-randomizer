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
import { CORNER_REVEAL } from "./card-affordance";
import { useT } from "@/lib/i18n";
import { useModal } from "@/lib/use-modal";
import { getCharacterName } from "@/lib/character-name";
import { getTagsForPerk, getTagsForRole } from "@/lib/perk-tags";
import { Dropdown } from "./dropdown";

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
  excludedSlugs: ReadonlySet<string>;
  /** Perks that read as unavailable for another reason (e.g. eliminated in
   *  Battle Royale) — shown with the same grayed-out treatment, just not
   *  counted in the "N excluded" badge or cleared by "Сбросить". */
  alsoGrayedOut?: ReadonlySet<string>;
  /** Favorited perks get boosted odds in getRandomPerks (see lib/perks.ts)
   *  instead of being force-included — a perk can be both favorited and
   *  excluded at once (exclusion always wins, it's just never drawn), so
   *  the two sets are intentionally independent. */
  favoriteSlugs: ReadonlySet<string>;
  onToggle: (slug: string) => void;
  onBulkSet: (slugs: string[], excluded: boolean) => void;
  onToggleFavorite: (slug: string) => void;
  onResetRole: (role: PerkRole) => void;
  onClose: () => void;
}) {
  const t = useT();
  const { attachCard, dialogProps } = useModal({
    open,
    onClose,
    label: t({ ru: "Настроить пул перков", en: "Manage perk pool" }),
  });
  const [search, setSearch] = useState("");
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<StatusFilter>("all");
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const perksForRole = useMemo(() => getPerksByRole(role), [role]);
  const roleColor = ROLE_COLOR[role];
  const tags = getTagsForRole(role);

  const activeCount = perksForRole.filter((p) => !excludedSlugs.has(p.slug)).length;

  /* How many perks each tag would show, if you clicked only that one.
  
     Narrowed by the state filter and the search, NOT by the other tags.
     Both halves of that are deliberate:
  
     The state filter and the search describe the list you are looking at.
     A tag reading "Aura 14" while you are filtered to Disabled and only
     three of those are disabled is a lie about what clicking will do, and
     it is the lie you would act on.
  
     The tags do not narrow each other because they are a multi-select OR
     group: picking Healing would make every other tag's number drop, for a
     reason nothing on screen explains, and picking a second tag is a
     perfectly sensible thing to do. A number that moves when you touch a
     different control is worse than no number.
  
     So each count answers exactly one question — "how many would this
     chip show on its own, here?" — and the sum can exceed the list length
     because a perk can carry several tags.
  
     One pass over the already-narrowed list, memoised: the tags live on
     each perk (see lib/perk-tags.ts, written by the scraper) so this is a
     cheap derivation, but it is still O(perks x tags) on every keystroke
     if left in the render body. */
  const tagCounts = useMemo(() => {
    const query = search.trim().toLowerCase();
    const counts = new Map<string, number>();
    for (const tag of tags) counts.set(tag.id, 0);
    for (const perk of perksForRole) {
      if (status === "active" && excludedSlugs.has(perk.slug)) continue;
      if (status === "disabled" && !excludedSlugs.has(perk.slug)) continue;
      if (status === "favorite" && !favoriteSlugs.has(perk.slug)) continue;
      if (query) {
        const haystack = `${perk.name.en} ${perk.name.ru}`.toLowerCase();
        if (!haystack.includes(query)) continue;
      }
      for (const tagId of getTagsForPerk(perk)) {
        const current = counts.get(tagId);
        if (current !== undefined) counts.set(tagId, current + 1);
      }
    }
    return counts;
  }, [perksForRole, tags, status, search, excludedSlugs, favoriteSlugs]);

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
            ref={attachCard}
            {...dialogProps}
            className="modal-card flex w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl lg:max-w-4xl"
          >
            <div className="flex items-center justify-between gap-3 border-b border-border p-4">
              <div className="text-left">
                <p className="font-semibold text-foreground">
                  {t({ ru: "Настроить пул перков", en: "Manage the perk pool" })}
                </p>
                <p className="text-hint text-muted">
                  {t({ ru: "Активно:", en: "Active:" })}{" "}
                  <b className={roleColor.text}>{activeCount}</b> / {perksForRole.length}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => onResetRole(role)}
                  className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-control font-medium text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
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
                      aria-label={t({ ru: "Поиск перка", en: "Search perks" })}
                      placeholder={t({
                        ru: "Поиск: EN или RU название…",
                        en: "Search: EN or RU name…",
                      })}
                      className="w-full rounded-full border border-border bg-background py-1.5 pr-3 pl-8 text-control text-foreground placeholder:text-muted/60 focus:ring-2 focus:ring-accent/40 focus:outline-none"
                    />
                  </div>
                  <Dropdown<SortField>
                    value={sortField}
                    onChange={setSortField}
                    label={t({ ru: "Сортировка", en: "Sort by" })}
                    className="border-border bg-background text-foreground"
                    options={[
                      { value: "name", label: t({ ru: "По названию", en: "By Name" }) },
                      { value: "character", label: t({ ru: "По персонажу", en: "By Character" }) },
                      { value: "date", label: t({ ru: "По дате добавления", en: "By Date Added" }) },
                    ]}
                  />
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
                  <p className="text-hint text-muted">
                    {t({
                      ru: "Пока не сортирует — у всех перков одна и та же дата первого добавления в базу сайта. Заработает, когда скрапер найдёт новый перк.",
                      en: "Doesn't reorder anything yet — every perk currently shares the same first-added-to-the-site date. Starts working once the scraper picks up a genuinely new perk.",
                    })}
                  </p>
                )}

                {/* Two groups, two rows, each labelled.
                
                    They were one wrapping row with a 1px rule between them,
                    and a divider inside a flex-wrap row cannot know which
                    visual line it landed on — the moment the chips wrapped,
                    the only thing separating eleven chips into two groups
                    was sitting in the middle of a row. Same incompatibility
                    the board's control panel documents.
                
                    They answer different questions: the first picks WHICH
                    perks, the second picks WHAT KIND. One from each is a
                    sensible thing to do, and the old flat list never said
                    so. Labelled rather than just spaced, because the state
                    row is single-select and the tag row is multi-select and
                    nothing about a chip's shape says which. */}
                <div
                  role="radiogroup"
                  aria-label={t({ ru: "Какие перки показывать", en: "Which perks to show" })}
                  className="flex flex-wrap items-center gap-1.5"
                >
                  <span className="mr-0.5 text-hint text-muted">
                    {t({ ru: "Показывать:", en: "Show:" })}
                  </span>
                  {(["all", "active", "disabled", "favorite"] as const).map((option) => (
                    <button
                      key={option}
                      type="button"
                      role="radio"
                      aria-checked={status === option}
                      onClick={() => setStatus(option)}
                      className={cn(
                        "flex items-center gap-1 rounded-full border px-3 py-1 text-hint font-medium transition-colors",
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
                </div>

                <div
                  role="group"
                  aria-label={t({ ru: "Фильтр по типу перка", en: "Filter by perk type" })}
                  className="flex flex-wrap items-center gap-1.5"
                >
                  <span className="mr-0.5 text-hint text-muted">
                    {t({ ru: "Тип:", en: "Type:" })}
                  </span>
                  {tags.map((tag) => {
                    const count = tagCounts.get(tag.id) ?? 0;
                    return (
                      <button
                        key={tag.id}
                        type="button"
                        aria-pressed={selectedTags.has(tag.id)}
                        onClick={() => toggleTag(tag.id)}
                        className={cn(
                          "flex items-center gap-1.5 rounded-full border px-3 py-1 text-hint font-medium transition-colors",
                          selectedTags.has(tag.id)
                            ? "border-accent/50 bg-accent/15 text-accent"
                            : "border-border text-muted hover:bg-surface-hover hover:text-foreground",
                          // Nothing to show, so say so rather than offering an
                          // empty list. Still clickable — disabling it would
                          // change behaviour, and the number is the warning.
                          count === 0 && !selectedTags.has(tag.id) && "opacity-50",
                        )}
                      >
                        {t({ ru: tag.ru, en: tag.en })}
                        {/* aria-hidden: the count is a preview for the eye.
                            A screen reader reading "Aura 14" as the button's
                            name would make the name change as you type. */}
                        <span aria-hidden className="tabular-nums opacity-60">
                          {count}
                        </span>
                      </button>
                    );
                  })}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onBulkSet(filteredSlugs, false)}
                    disabled={filteredSlugs.length === 0}
                    className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-control font-medium text-muted transition-colors hover:bg-surface-hover hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
                  >
                    <CheckCheck className="size-3.5" />
                    {t({ ru: "Включить все", en: "Enable All" })}
                  </button>
                  <button
                    type="button"
                    onClick={() => onBulkSet(filteredSlugs, true)}
                    disabled={filteredSlugs.length === 0}
                    className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-control font-medium text-muted transition-colors hover:bg-surface-hover hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
                  >
                    <Ban className="size-3.5" />
                    {t({ ru: "Отключить все", en: "Disable All" })}
                  </button>
                  <span className="text-hint text-muted">
                    {t({ ru: "Показано:", en: "Showing:" })} {filtered.length}
                  </span>
                </div>
              </div>

              {filtered.length === 0 ? (
                <p className="p-8 text-center text-hint text-muted">
                  {t({ ru: "Ничего не найдено", en: "Nothing matches" })}
                </p>
              ) : (
                <div className="grid grid-cols-3 gap-2 p-4 sm:grid-cols-4 lg:grid-cols-6">
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
                          /* Only the card's OWN keys.
                          
                             The favourite button sits inside this card, so
                             Enter pressed on it bubbles here — and this
                             handler's preventDefault cancelled the button's
                             own activation before it happened. Measured:
                             tabbing to the star and pressing Enter toggled
                             the perk's EXCLUSION and left the favourite
                             untouched. It predates the star being hidden,
                             but a control that is only revealed on focus had
                             better work when you get there.
                          
                             perk-grid.tsx's card avoids this by accident:
                             its isKeyboardFocused guard compares against
                             document.activeElement, which is the child when
                             a child is focused. This one had no guard. */
                          if (e.target !== e.currentTarget) return;
                          if (e.key !== "Enter" && e.key !== " ") return;
                          e.preventDefault();
                          onToggle(perk.slug);
                        }}
                        className={cn(
                          "group relative flex cursor-pointer flex-col items-center gap-1 rounded-xl border p-2 text-center transition-all",
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
                          /* A set favourite is always drawn — it is the
                             state, not an affordance. An unset one is the
                             offer to set it, and 176 identical outlined
                             stars is 176 marks that mean nothing until one
                             of them does. So the empty star follows the
                             same reveal the card controls elsewhere use.
                          
                             Absolutely positioned, so nothing reflows when
                             it appears; the space was never in the flow to
                             begin with. */
                          className={cn(
                            "absolute top-1 left-1 flex size-4 items-center justify-center rounded-full bg-black/60 transition-opacity",
                            /* The one colour left outside the tokens, on
                               purpose. It sits on its own bg-black/60 plate,
                               so it never meets either theme's surface and
                               measures 9.57 against that plate in both — the
                               same reasoning .icon-art uses. It is also a
                               gold star, which is a convention rather than a
                               status, so folding it into --status-* would
                               say something it does not mean. */
                            favoriteSlugs.has(perk.slug)
                              ? "text-amber-400 opacity-100"
                              : cn(CORNER_REVEAL, "text-white/50 hover:text-white"),
                          )}
                        >
                          <Star
                            className="size-2.5"
                            fill={favoriteSlugs.has(perk.slug) ? "currentColor" : "none"}
                          />
                        </button>
                        {/* Lazy for the same reason as the loadout pool: a
                            few hundred rows, each with its own icon, none of
                            them visible until scrolled to. */}
                        {/* eslint-disable-next-line @next/next/no-img-element -- next/image ignores basePath for unoptimized runtime src, see lib/asset-path.ts */}
                        <img
                          src={withBasePath(perk.icon)}
                          loading="lazy"
                          decoding="async"
                          alt={perk.name[language]}
                          width={48}
                          height={48}
                          className="size-12 rounded-lg icon-art object-cover"
                        />
                        <span className="text-meta leading-tight text-foreground">
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
