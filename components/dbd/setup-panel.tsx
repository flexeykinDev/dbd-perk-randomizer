"use client";

import { Users, X } from "lucide-react";
import { ControlGroup, ControlPanel } from "./control-panel";
import { Dropdown } from "./dropdown";
import { ToggleSwitch } from "./toggle-switch";
import { getTagsForRole } from "@/lib/perk-tags";
import { getCharacterName } from "@/lib/character-name";
import { getCharacterPortrait } from "@/lib/perks";
import { withBasePath } from "@/lib/asset-path";
import { ROLE_COLOR } from "@/lib/role-color";
import { COHERENCE_LEVELS, type CoherenceLevel } from "@/lib/coherence";
import { cn } from "@/lib/cn";
import { useT, type Lang } from "@/lib/i18n";
import type { BuildMode, PerkRole } from "@/lib/types";

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
}: {
  mode: BuildMode;
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
}) {
  const t = useT();
  const roleColor = ROLE_COLOR[role];
  const tags = mounted ? getTagsForRole(role) : [];

  return (
    <>
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
          </ControlGroup>
        )}
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
      </div>
    </>
  );
}
