"use client";

import { Check, Copy, Search, Wrench, X } from "lucide-react";
import { withBasePath } from "@/lib/asset-path";
import { cn } from "@/lib/cn";
import { useT, type Lang } from "@/lib/i18n";
import type { BuildConstructor } from "@/lib/use-build-constructor";
import type { CopyFeedback } from "@/lib/use-copy-feedback";

/** Assembles a !paste command by hand, for a build that isn't the one
 *  currently rolled on the site. Used to be buried three levels deep
 *  (Twitch → Advanced → "paste enabled"); it's a tab of its own now. */
export function ObsConstructorPanel({
  constructor: build,
  copy,
  language,
  pasteEnabled,
}: {
  constructor: BuildConstructor;
  copy: CopyFeedback;
  language: Lang;
  /** Only used to warn that the command won't do anything in chat yet —
   *  the constructor itself works regardless. */
  pasteEnabled: boolean;
}) {
  const t = useT();

  return (
    <div className="mt-4 rounded-xl border border-border bg-background/60 p-3.5">
      <div className="mb-2 flex items-center gap-2">
        <Wrench className="size-3.5 text-muted" />
        <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">
          {t({ ru: "Конструктор билда", en: "Build constructor" })}
        </h3>
      </div>
      <p className="mb-3 text-xs text-muted/80">
        {t({
          ru: "Собери билд с нуля — независимо от того, что сгенерировано на сайте сейчас, например чтобы заранее подготовить билд для анонса.",
          en: "Build one from scratch — independent of whatever's currently rolled on the main site, e.g. to prepare an announcement build ahead of time.",
        })}
      </p>

      <div className="flex flex-col gap-2 rounded-lg border border-border bg-background/60 p-2.5">
        <div className="flex items-center gap-1.5">
          {(["survivor", "killer"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => build.setRole(option)}
              className={cn(
                "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                build.role === option
                  ? "border-accent/50 bg-accent/15 text-accent"
                  : "border-border text-muted hover:bg-surface-hover hover:text-foreground",
              )}
            >
              {option === "survivor"
                ? t({ ru: "Выживший", en: "Survivor" })
                : t({ ru: "Убийца", en: "Killer" })}
            </button>
          ))}
          <span className="ml-auto text-[11px] text-muted">
            {build.selected.length}/{build.maxSlots}
          </span>
          {build.selected.length > 0 && (
            <button
              type="button"
              onClick={build.clear}
              className="text-[11px] font-medium text-muted transition-colors hover:text-foreground"
            >
              {t({ ru: "Очистить", en: "Clear" })}
            </button>
          )}
        </div>

        <div className="flex min-h-9 flex-wrap gap-1.5">
          {Array.from({ length: build.maxSlots }, (_, i) => build.selected[i]).map((perk, i) =>
            perk ? (
              <button
                key={perk.slug}
                type="button"
                onClick={() => build.toggle(perk)}
                title={perk.name[language]}
                className="relative flex size-9 items-center justify-center rounded-lg border-2 border-accent bg-black/70"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- tiny selection-slot thumbnail, next/image is overkill here */}
                <img
                  src={withBasePath(perk.icon)}
                  alt={perk.name[language]}
                  width={32}
                  height={32}
                  className="size-8 rounded object-cover"
                />
                <span className="absolute -top-1.5 -right-1.5 flex size-3.5 items-center justify-center rounded-full bg-red-500 text-white">
                  <X className="size-2.5" />
                </span>
              </button>
            ) : (
              <span
                key={`empty-${i}`}
                className="size-9 rounded-lg border-2 border-dashed border-border"
              />
            ),
          )}
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-3 -translate-y-1/2 text-muted" />
          <input
            type="text"
            value={build.search}
            onChange={(e) => build.setSearch(e.target.value)}
            placeholder={t({ ru: "Поиск перка…", en: "Search perks…" })}
            aria-label={t({ ru: "Поиск перка", en: "Search perks" })}
            className="w-full rounded-full border border-border bg-background py-1.5 pr-3 pl-7 text-[11px] text-foreground placeholder:text-muted/60 focus:ring-2 focus:ring-accent/40 focus:outline-none"
          />
        </div>

        {/* auto-fill rather than a fixed 6 columns: the modal is much wider
            than the old grid assumed, so 6 columns of 30px icons left most
            of the row empty while the list scrolled inside a 10rem window.
            Columns now follow the available width and the icons are big
            enough to recognise a perk by its art. */}
        <div className="grid max-h-72 grid-cols-[repeat(auto-fill,minmax(48px,1fr))] gap-1.5 overflow-y-auto">
          {build.filtered.map((perk) => {
            const selected = build.isSelected(perk);
            return (
              <button
                key={perk.slug}
                type="button"
                onClick={() => build.toggle(perk)}
                title={perk.name[language]}
                disabled={!selected && build.isFull}
                className={cn(
                  "flex items-center justify-center rounded-lg border-2 p-0.5 transition-colors disabled:cursor-not-allowed disabled:opacity-30",
                  selected ? "border-accent" : "border-transparent hover:border-border",
                )}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- tiny picker thumbnail, next/image is overkill here */}
                <img
                  src={withBasePath(perk.icon)}
                  alt={perk.name[language]}
                  width={44}
                  height={44}
                  className="size-11 rounded icon-art object-cover"
                />
              </button>
            );
          })}
        </div>

        {build.command ? (
          <div className="flex items-center gap-1.5 border-t border-border pt-2">
            <code className="min-w-0 flex-1 truncate rounded-full border border-border bg-background px-2.5 py-1 text-[11px] text-foreground">
              {build.command}
            </code>
            <button
              type="button"
              onClick={() =>
                copy.copy(
                  "constructor",
                  build.command!,
                  t({ ru: "Команда скопирована", en: "Command copied" }),
                )
              }
              aria-label={t({ ru: "Скопировать команду", en: "Copy command" })}
              className="flex size-6 shrink-0 items-center justify-center rounded-full border border-border text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
            >
              {copy.isCopied("constructor") ? (
                <Check className="size-3 text-accent" />
              ) : (
                <Copy className="size-3" />
              )}
            </button>
          </div>
        ) : (
          <p className="border-t border-border pt-2 text-[11px] text-muted/70">
            {t({
              ru: "Выбери до 4 перков, чтобы получить команду.",
              en: "Pick up to 4 perks to get a command.",
            })}
          </p>
        )}
      </div>

      {!pasteEnabled && (
        <p className="mt-3 text-[11px] text-muted/60">
          {t({
            ru: "Команда «вставить билд по коду» сейчас выключена во вкладке Twitch — включи её там, чтобы зрители могли использовать эту команду в чате.",
            en: 'The "paste a build by code" command is currently off in the Twitch tab — turn it on there for viewers to actually use this command in chat.',
          })}
        </p>
      )}
    </div>
  );
}
