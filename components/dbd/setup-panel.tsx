"use client";

import { RotateCcw, Users, X } from "lucide-react";
import { BattleRoyaleControl } from "./battle-royale-control";
import { ControlGroup, ControlPanel } from "./control-panel";
import { Dropdown } from "./dropdown";
import { PerkCountSelect } from "./perk-count-select";
import { ToggleSwitch } from "./toggle-switch";
import { getTagsForRole } from "@/lib/perk-tags";
import { getCharacterName } from "@/lib/character-name";
import { getCharacterPortrait } from "@/lib/perks";
import { withBasePath } from "@/lib/asset-path";
import { ROLE_COLOR } from "@/lib/role-color";
import { COHERENCE_LEVELS, type CoherenceLevel } from "@/lib/coherence";
import { cn } from "@/lib/cn";
import { useT, type Lang } from "@/lib/i18n";
import type { BuildMode, LoadoutSlots, PerkRole } from "@/lib/types";

/* Named rather than numbered: "2" says nothing about what it does, and the
   scale is short enough that four words fit where four digits would. */
const COHERENCE_LABEL: Record<CoherenceLevel, { ru: string; en: string }> = {
  0: { ru: "Хаос", en: "Chaos" },
  1: { ru: "Слегка", en: "Light" },
  2: { ru: "Заметно", en: "Strong" },
  3: { ru: "Синергия", en: "Synergy" },
};

const COHERENCE_HINT: Record<CoherenceLevel, { ru: string; en: string }> = {
  0: {
    ru: "Обычный случайный билд — перки не связаны между собой.",
    en: "The ordinary random build — perks have nothing to do with each other.",
  },
  1: {
    ru: "Перки, подходящие друг другу, выпадают немного чаще.",
    en: "Perks that fit what you already rolled come up a little more often.",
  },
  2: {
    ru: "Перки, подходящие друг другу, выпадают заметно чаще.",
    en: "Perks that fit what you already rolled come up noticeably more often.",
  },
  3: {
    ru: "Билд собирается вокруг одной темы. Все перки остаются доступными — просто реже.",
    en: "The build gathers around one idea. Every perk is still reachable, just rarer.",
  },
};

/**
 * The controls you set once a session and stop thinking about: which idea the
 * pool is narrowed to, how hard the roll leans toward a build that hangs
 * together, and whose character the build belongs to.
 *
 * They are in the disclosure rather than on the board for exactly that reason.
 * The board carried five rows of controls above the build, all with the same
 * pill treatment and the same weight, so nothing read as more important than
 * anything else and the build started a long way down. What is left outside is
 * what you change *between* rolls — see roll-shape-panel.tsx.
 *
 * Gated on `mounted` where the options come from shipped data: the tag list
 * and the portrait grid are both read client-side, and rendering them during
 * the server pass would hydrate against a different tree.
 */
export function SetupPanel({
  mode,
  onSelectMode,
  perkCount,
  onSelectPerkCount,
  loadoutSlots,
  onToggleLoadoutSlot,
  role,
  mounted,
  language,
  themeTag,
  onSelectTheme,
  coherenceLevel,
  onSelectCoherence,
  selectedCharacter,
  onOpenCharacterPicker,
  onClearCharacter,
  guaranteeTeachables,
  onToggleGuaranteeTeachables,
  battleRoyale,
  availableCount,
  onToggleBattleRoyale,
  filtersAtDefault,
  onResetFilters,
}: {
  mode: BuildMode;
  onSelectMode: (next: BuildMode) => void;
  perkCount: number;
  onSelectPerkCount: (next: number) => void;
  loadoutSlots: LoadoutSlots;
  onToggleLoadoutSlot: (slot: keyof LoadoutSlots) => void;
  role: PerkRole;
  mounted: boolean;
  language: Lang;
  themeTag: string | null;
  onSelectTheme: (tag: string | null) => void;
  coherenceLevel: CoherenceLevel;
  onSelectCoherence: (level: CoherenceLevel) => void;
  selectedCharacter: string | null;
  onOpenCharacterPicker: () => void;
  onClearCharacter: () => void;
  guaranteeTeachables: boolean;
  onToggleGuaranteeTeachables: () => void;
  battleRoyale: boolean;
  /** Already filtered to the current role — see lib/use-battle-royale.ts for
   *  why a raw count would disagree with the pool size beside it. */
  availableCount: number;
  onToggleBattleRoyale: () => void;
  /** Hides the reset, because a button that cannot change anything is a
   *  control you have to read before ignoring. Its absence is also the
   *  clearest statement that nothing is currently narrowing your rolls. */
  filtersAtDefault: boolean;
  onResetFilters: () => void;
}) {
  const t = useT();
  const roleColor = ROLE_COLOR[role];
  const tags = mounted ? getTagsForRole(role) : [];

  return (
    <>
      {/* What you are rolling. First in the panel because it is the broadest
          question here, and the only one that changes which grids the board
          draws at all.
      
          These two were on the board until this pass. Role is the one choice
          worth making before a first roll — the defaults answer everything
          else well — so the board now carries role, this disclosure, the
          result and Generate, and nothing more. The trigger enumerates what
          is inside precisely so moving them in here does not make Full
          Loadout undiscoverable. */}
      <ControlPanel>
        <ControlGroup label={t({ ru: "Режим:", en: "Mode:" })}>
          <div className="flex items-center gap-1 rounded-full border border-border bg-surface/60 p-1 text-control">
            {(["perks", "loadout", "all"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => onSelectMode(m)}
                className={cn(
                  "tap rounded-full px-3 py-1 text-control font-medium transition-colors",
                  mode === m
                    ? "bg-surface-hover font-semibold text-foreground"
                    : "text-muted hover:text-foreground",
                )}
              >
                {m === "perks"
                  ? t({ ru: "Перки", en: "Perks" })
                  : m === "loadout"
                    ? t({ ru: "Экипировка", en: "Full Loadout" })
                    : t({ ru: "Всё", en: "Both" })}
              </button>
            ))}
          </div>
        </ControlGroup>

        {mode !== "loadout" && (
          <ControlGroup label={t({ ru: "Сколько:", en: "How many:" })}>
            <PerkCountSelect value={perkCount} onChange={onSelectPerkCount} />
          </ControlGroup>
        )}

        {/* Beside the mode that summons them, rather than on the board.
            Leaving these outside meant switching to Full Loadout in here and
            then finding its slots somewhere else entirely. */}
        {mode !== "perks" && (
          <ControlGroup label={t({ ru: "Слоты:", en: "Slots:" })}>
            {(
              [
                ["item", { ru: "Предмет", en: "Item" }],
                ["addons", { ru: "Аддоны", en: "Add-ons" }],
                ["offering", { ru: "Подношение", en: "Offering" }],
              ] as const
            )
              // The killer's is a Power, which they always have — nothing to
              // turn off.
              .filter(([slot]) => role === "survivor" || slot !== "item")
              .map(([slot, label]) => (
                <button
                  key={slot}
                  type="button"
                  onClick={() => onToggleLoadoutSlot(slot)}
                  className={cn(
                    "rounded-full border px-3 py-1 text-control font-medium transition-colors",
                    loadoutSlots[slot]
                      ? cn(roleColor.border, roleColor.bg, roleColor.text)
                      : "border-border text-muted hover:bg-surface-hover hover:text-foreground",
                  )}
                >
                  {t(label)}
                </button>
              ))}
          </ControlGroup>
        )}
      </ControlPanel>

      <ControlPanel>
        {mode !== "loadout" && tags.length > 0 && (
          <ControlGroup label={t({ ru: "Тема:", en: "Theme:" })}>
            <Dropdown
              value={themeTag ?? ""}
              onChange={(v) => onSelectTheme(v || null)}
              label={t({ ru: "Тема билда", en: "Build theme" })}
              className="border-border bg-background text-foreground"
              options={[
                { value: "", label: t({ ru: "Любая", en: "Any" }) },
                ...tags.map((tag) => ({
                  value: tag.id,
                  label: t({ ru: tag.ru, en: tag.en }),
                })),
              ]}
            />
          </ControlGroup>
        )}

        {/* Sits beside Theme because the two answer neighbouring questions,
            and reads as the softer of the pair on purpose: Theme narrows the
            pool to one idea, this only tilts the draw and leaves every perk
            reachable. */}
        {mode !== "loadout" && mounted && (
          <ControlGroup label={t({ ru: "Связность:", en: "Coherence:" })}>
            <div
              className="flex items-center gap-1"
              role="radiogroup"
              aria-label={t({ ru: "Связность билда", en: "Build coherence" })}
            >
              {COHERENCE_LEVELS.map((level) => (
                <button
                  key={level}
                  type="button"
                  role="radio"
                  aria-checked={coherenceLevel === level}
                  onClick={() => onSelectCoherence(level)}
                  title={t(COHERENCE_HINT[level])}
                  className={cn(
                    "tap rounded-full border px-2.5 py-1 text-control font-semibold transition-colors",
                    coherenceLevel === level
                      ? cn(roleColor.border, roleColor.bg, roleColor.text)
                      : "border-border text-muted hover:bg-surface-hover hover:text-foreground",
                  )}
                >
                  {t(COHERENCE_LABEL[level])}
                </button>
              ))}
            </div>
            {/* The same sentence the title attribute carries, said out loud for
                the selected level.
            
                A `title` is a mouse affordance: it never appears for someone
                tabbing through the radios, and on a touch screen it does not
                exist at all. Four words on a pill cannot explain what
                "Синергия" does to a roll, and this is the one control here
                whose effect is invisible until you have rolled a few times.
                Costs nothing at rest — the whole panel is behind the
                disclosure. */}
            <p className="w-full text-hint text-muted">
              {t(COHERENCE_HINT[coherenceLevel])}
            </p>
          </ControlGroup>
        )}

      </ControlPanel>

      <ControlPanel>
        {/* Battle Royale lives here now, not on the board.
        
            It is a whole alternate game mode — play until the pool runs dry —
            and it was sitting in the primary toolbar, on screen for every
            visitor before their first roll, including the overwhelming
            majority who will never start one. That is what "secondary" is for.
        
            It stays reachable in one click from the same place as the other
            things you set once, and while it is running the board's own
            subtitle carries the remaining count, so turning it on does not
            mean watching a number that is behind a collapsed panel.
        
            In a row of its own rather than beside Theme and Coherence. Those
            two plus the coherence helper measured 1233px of content inside an
            834px panel at 1366px wide, which put this switch at x=1103 —
            outside the box, reachable only by a horizontal scrollbar nobody
            looks for. A ControlPanel scrolls rather than wraps on purpose (a
            divider cannot know which line it landed on), so the fix is fewer
            segments per row, not a different overflow. */}
        <BattleRoyaleControl
          active={battleRoyale}
          onToggle={onToggleBattleRoyale}
          remaining={availableCount}
        />
      </ControlPanel>

      {/* Character picker — picks a specific character for the portrait chip
          and, in Perks mode with the toggle on, guarantees their own teachable
          perks in the roll; in Loadout mode for killer, it's what actually
          decides whose Power/add-ons get rolled (see getRandomLoadout's
          forcedCharacter). A modal with a search + portrait grid, not a single
          "reroll" button — Space/Generate already rerolls the build at random,
          so this is specifically for choosing *which* character, with random
          still available as one option inside rather than the only one. */}
      <div className="flex flex-wrap items-center justify-center gap-2">
        {selectedCharacter ? (
          <div className="flex items-center gap-2 rounded-full border border-border bg-surface/60 py-1 pr-1 pl-1.5">
            <button
              type="button"
              onClick={onOpenCharacterPicker}
              className="flex items-center gap-2 rounded-full"
            >
              <span
                className={cn(
                  "relative flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-full ring-1 ring-offset-1 ring-offset-surface",
                  roleColor.ring,
                )}
              >
                {getCharacterPortrait(selectedCharacter) ? (
                  // eslint-disable-next-line @next/next/no-img-element -- next/image ignores basePath for unoptimized runtime src, see lib/asset-path.ts
                  <img
                    src={withBasePath(
                      getCharacterPortrait(selectedCharacter) as string,
                    )}
                    alt={getCharacterName(selectedCharacter, language)}
                    className="size-7 object-cover"
                  />
                ) : (
                  <span className="text-hint text-muted">?</span>
                )}
              </span>
              <span className="text-control font-medium text-foreground">
                {getCharacterName(selectedCharacter, language)}
              </span>
            </button>
            <button
              type="button"
              onClick={onClearCharacter}
              aria-label={t({ ru: "Убрать персонажа", en: "Clear character" })}
              className="flex size-5 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
            >
              <X className="size-3" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={onOpenCharacterPicker}
            className="tap flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-control font-medium text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
          >
            <Users className="size-3.5" />
            {t({ ru: "Выбрать персонажа", en: "Choose Character" })}
          </button>
        )}

        {mode !== "loadout" && selectedCharacter && (
          <ToggleSwitch
            checked={guaranteeTeachables}
            onChange={onToggleGuaranteeTeachables}
            // "Тичеблы" was the English term in Cyrillic letters and read as
            // nonsense to anyone who had not seen "teachables" written down.
            // The tooltip right beside it already said "собственные перки
            // этого персонажа"; the label now uses the same words.
            label={t({
              ru: "Гарантировать личные перки",
              en: "Guarantee teachables",
            })}
            tooltip={t({
              ru: "В билд гарантированно попадут собственные перки этого персонажа (если они не исключены из пула).",
              en: "The build is guaranteed to include this character's own perks (unless they're excluded from the pool).",
            })}
          />
        )}

        {/* Appears only when there is something to undo.
        
            Sits at the end of the panel it undoes, rather than next to
            Generate: it belongs to the settings, and a destructive-sounding
            word beside the primary action would make people hesitate over the
            one button they came to press. Quiet by weight like the export row
            — muted type, border only on hover — because undoing a filter is
            not an achievement. It does not touch the perk pool; that has its
            own Reset inside Manage Pool, where the list is visible. */}
        {!filtersAtDefault && (
          <button
            type="button"
            onClick={onResetFilters}
            title={t({
              ru: "Сбрасывает количество перков, режим, слоты, тему, связность, персонажа, Battle Royale, группу и сид. Пул перков и избранное не трогает.",
              en: "Resets perk count, mode, slots, theme, coherence, character, Battle Royale, squad and seed. Leaves your perk pool and favourites alone.",
            })}
            className="tap flex items-center gap-1.5 rounded-full border border-transparent px-3 py-1.5 text-control font-medium text-muted transition-colors hover:border-border hover:bg-surface-hover hover:text-foreground"
          >
            <RotateCcw className="size-3.5" />
            {t({ ru: "Сбросить настройки", en: "Reset settings" })}
          </button>
        )}
      </div>
    </>
  );
}
