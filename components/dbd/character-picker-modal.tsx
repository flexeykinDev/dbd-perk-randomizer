"use client";

import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Shuffle, Search, X } from "lucide-react";
import type { PerkRole } from "@/lib/types";
import { withBasePath } from "@/lib/asset-path";
import { getCharacterPortrait } from "@/lib/perks";
import { getCharacterName } from "@/lib/character-name";
import { ROLE_COLOR } from "@/lib/role-color";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n";
import { useModal } from "@/lib/use-modal";

/** Pick-a-character modal — a portrait grid instead of a single "roll
 *  random" button, since Space/Generate already rerolls the build at
 *  random; this is specifically for choosing *which* character, with an
 *  explicit shuffle as one option among the rest rather than the only one. */
export function CharacterPickerModal({
  open,
  role,
  language,
  characters,
  selected,
  onSelect,
  onClose,
}: {
  open: boolean;
  role: PerkRole;
  language: "en" | "ru";
  characters: string[];
  selected: string | null;
  onSelect: (character: string | null) => void;
  onClose: () => void;
}) {
  const t = useT();
  const { attachCard, dialogProps } = useModal({
    open,
    onClose,
    label: t({ ru: "Выбор персонажа", en: "Character picker" }),
  });
  const [search, setSearch] = useState("");
  const roleColor = ROLE_COLOR[role];

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return characters;
    return characters.filter((c) => getCharacterName(c, language).toLowerCase().includes(query));
  }, [characters, search, language]);

  function pickRandom() {
    if (filtered.length === 0) return;
    onSelect(filtered[Math.floor(Math.random() * filtered.length)]);
    onClose();
  }

  function pick(character: string) {
    onSelect(character);
    onClose();
  }

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
            className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl lg:max-w-4xl"
          >
            <div className="flex items-center justify-between gap-3 border-b border-border p-4">
              <p className="font-semibold text-foreground">
                {t({ ru: "Выбрать персонажа", en: "Choose a Character" })}
              </p>
              <button
                type="button"
                onClick={onClose}
                aria-label={t({ ru: "Закрыть", en: "Close" })}
                className="flex size-8 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto">
              <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-border bg-surface p-4">
                <div className="relative min-w-40 flex-1">
                  <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted" />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    aria-label={t({ ru: "Поиск персонажа", en: "Search characters" })}
                    placeholder={t({ ru: "Поиск персонажа…", en: "Search character…" })}
                    className="w-full rounded-full border border-border bg-background py-1.5 pr-3 pl-8 text-xs text-foreground placeholder:text-muted/60 focus:ring-2 focus:ring-accent/40 focus:outline-none"
                  />
                </div>
                <button
                  type="button"
                  onClick={pickRandom}
                  disabled={filtered.length === 0}
                  className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-surface-hover hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
                >
                  <Shuffle className="size-3.5" />
                  {t({ ru: "Случайный", en: "Random" })}
                </button>
                {selected && (
                  <button
                    type="button"
                    onClick={() => {
                      onSelect(null);
                      onClose();
                    }}
                    className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
                  >
                    <X className="size-3.5" />
                    {t({ ru: "Убрать выбор", en: "Clear selection" })}
                  </button>
                )}
              </div>

              {filtered.length === 0 ? (
                <p className="p-8 text-center text-sm text-muted">
                  {t({ ru: "Ничего не найдено", en: "Nothing matches" })}
                </p>
              ) : (
                <div className="grid grid-cols-4 gap-2 p-4 sm:grid-cols-6 lg:grid-cols-8">
                  {filtered.map((character) => {
                    const portrait = getCharacterPortrait(character);
                    const isSelected = character === selected;
                    return (
                      <button
                        key={character}
                        type="button"
                        onClick={() => pick(character)}
                        className={cn(
                          "flex flex-col items-center gap-1 rounded-xl border p-2 text-center transition-colors",
                          isSelected
                            ? cn(roleColor.border, roleColor.bg)
                            : cn("border-border", roleColor.hoverBorder, "hover:bg-surface-hover"),
                        )}
                      >
                        <span
                          className={cn(
                            "relative size-12 shrink-0 overflow-hidden rounded-full ring-2 ring-offset-2 ring-offset-surface",
                            isSelected ? roleColor.ring : "ring-transparent",
                          )}
                        >
                          {portrait ? (
                            // eslint-disable-next-line @next/next/no-img-element -- next/image ignores basePath for unoptimized runtime src, see lib/asset-path.ts
                            <img
                              src={withBasePath(portrait)}
                              loading="lazy"
                              decoding="async"
                              alt={getCharacterName(character, language)}
                              className="size-12 object-cover"
                            />
                          ) : (
                            <span className="flex size-12 items-center justify-center bg-surface text-muted">?</span>
                          )}
                        </span>
                        <span className="text-[0.625rem] leading-tight text-foreground">
                          {getCharacterName(character, language)}
                        </span>
                      </button>
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
