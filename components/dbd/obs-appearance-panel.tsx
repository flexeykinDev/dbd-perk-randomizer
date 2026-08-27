"use client";

import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/cn";
import { entranceMotion } from "@/lib/obs-entrance";
import { useT } from "@/lib/i18n";
import type { PieceVisibility } from "@/lib/types";
import {
  MAX_CANVAS_HEIGHT,
  MAX_CANVAS_WIDTH,
  MIN_CANVAS_HEIGHT,
  MIN_CANVAS_WIDTH,
  STYLE_PRESETS,
  type ObsOverlayOptions,
} from "@/lib/use-obs-overlay-options";
import {
  MAX_OBS_NAME_SCALE,
  MAX_OBS_SCALE,
  MIN_OBS_NAME_SCALE,
  MIN_OBS_SCALE,
  OBS_ENTRANCES,
  type ObsEntrance,
} from "@/lib/use-obs-mode";
import { ToggleSwitch } from "./toggle-switch";

/** What the motion actually does, for the preview caption. The chip names
 *  are nouns and three of them just mean "it moves". */
const ENTRANCE_HINT: Record<ObsEntrance, { ru: string; en: string }> = {
  rise: { ru: "Всплывает снизу и увеличивается", en: "Floats up and grows into place" },
  drop: { ru: "Падает сверху с отскоком", en: "Falls from above and bounces" },
  flip: { ru: "Переворачивается, как карта", en: "Turns over like a card" },
  glide: { ru: "Выезжает слева, без масштаба", en: "Slides in from the left, no scaling" },
  none: { ru: "Только плавное появление", en: "Crossfade only, nothing moves" },
};

const ENTRANCE_LABEL: Record<ObsEntrance, { ru: string; en: string }> = {
  rise: { ru: "Всплытие", en: "Rise" },
  drop: { ru: "Падение", en: "Drop" },
  flip: { ru: "Переворот", en: "Flip" },
  glide: { ru: "Сдвиг", en: "Glide" },
  none: { ru: "Без анимации", en: "None" },
};

/* A live preview of what an entrance actually looks like.
 *
 * The five names are the problem this solves: "Rise", "Drop", "Glide" all
 * mean roughly "it moves", and picking between them meant choosing one,
 * closing the modal, rolling a build, and watching the overlay — per option.
 *
 * The motion is read from entranceMotion, the same function the overlay
 * itself uses, rather than being reimplemented here. A hand-drawn imitation
 * would be a second definition of each animation and would drift away from
 * the real one the first time either changed.
 */
const PREVIEW_CARDS = 3;
const PREVIEW_LOOP_MS = 1900;

function EntrancePreview({ entrance }: { entrance: ObsEntrance }) {
  const t = useT();
  const [tick, setTick] = useState(0);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (reduced) return;
    // Named for the same reason as the restores in lib/ — the compiler's lint
    // rejects a bare setState in an effect body.
    function replay() {
      setTick((n) => n + 1);
    }
    const id = setInterval(replay, PREVIEW_LOOP_MS);
    return () => clearInterval(id);
  }, [reduced]);

  return (
    <div
      className="mt-2 overflow-hidden rounded-lg border border-border bg-background/40"
      // Decorative: the chips carry the names and the caption repeats the
      // description, so a screen reader gains nothing from the rectangles.
      aria-hidden
      data-testid="entrance-preview"
      data-entrance={entrance}
    >
      <div
        className="flex h-20 items-center justify-center gap-2"
        style={{ perspective: entrance === "flip" ? 700 : undefined }}
      >
        {reduced ? (
          <span className="text-[0.6875rem] text-muted">
            {t({ ru: "Анимация отключена в системе", en: "Motion is off in your system settings" })}
          </span>
        ) : (
          Array.from({ length: PREVIEW_CARDS }, (_, i) => {
            const motion_ = entranceMotion(entrance, i);
            return (
              <motion.span
                // Re-keyed each loop so the entrance replays from the start.
                key={`${entrance}-${tick}-${i}`}
                initial={motion_.initial}
                animate={motion_.animate}
                transition={motion_.transition}
                // Shaped like the overlay's own cards — a portrait tile with a
                // name bar under it — so the preview reads as "a build
                // arriving" rather than as three abstract squares.
                className="flex h-14 w-11 flex-col overflow-hidden rounded-md border border-accent/50 bg-accent/10 shadow-sm"
              >
                <span className="flex-1 bg-gradient-to-b from-accent/35 to-accent/10" />
                <span className="h-2.5 border-t border-accent/30 bg-surface/70" />
              </motion.span>
            );
          })
        )}
      </div>
      <p className="border-t border-border/60 px-2.5 py-1.5 text-center text-[0.625rem] text-muted">
        {t(ENTRANCE_HINT[entrance])}
      </p>
    </div>
  );
}

/** Everything under "Appearance": the style presets, the custom dials they
 *  stand in for, the three display toggles, and which piece kinds reach the
 *  overlay at all. */
export function ObsAppearancePanel({
  options,
  mode,
  pieceVisibility,
  onPieceVisibilityChange,
}: {
  options: ObsOverlayOptions;
  mode: "perks" | "loadout" | "all";
  pieceVisibility: PieceVisibility;
  onPieceVisibilityChange: (kind: keyof PieceVisibility, value: boolean) => void;
}) {
  const t = useT();
  /** Which entrance the preview is showing, when it is not the chosen one. */
  const [previewing, setPreviewing] = useState<ObsEntrance | null>(null);

  return (
    <div className="mt-5 flex flex-col gap-3">
      <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">
        {t({ ru: "Оформление", en: "Appearance" })}
      </h3>

      <div
        className="grid grid-cols-4 gap-1.5"
        role="group"
        aria-label={t({ ru: "Стиль оверлея", en: "Overlay style" })}
      >
        {STYLE_PRESETS.map((preset) => (
          <PresetButton
            key={preset.id}
            label={t(preset.label)}
            active={options.styleMode === preset.id}
            onClick={() => options.applyStylePreset(preset)}
          />
        ))}
        <PresetButton
          label={t({ ru: "Свой", en: "Custom" })}
          active={options.styleMode === "custom"}
          onClick={options.useCustomStyle}
        />
      </div>
      {options.activePresetDescription && (
        <p className="-mt-1 text-[0.6875rem] text-muted">{t(options.activePresetDescription)}</p>
      )}

      {options.styleMode === "custom" && (
        <div className="flex flex-col gap-4 rounded-lg border border-border bg-background/40 p-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <label htmlFor={options.canvasWidthId} className="text-[0.6875rem] text-muted">
              {t({ ru: "Холст OBS:", en: "OBS canvas:" })}
            </label>
            <input
              id={options.canvasWidthId}
              type="number"
              min={MIN_CANVAS_WIDTH}
              max={MAX_CANVAS_WIDTH}
              value={options.canvasWidth}
              onChange={(e) => options.updateCanvasWidth(Number(e.target.value))}
              aria-label={t({ ru: "Ширина холста, пикселей", en: "Canvas width, pixels" })}
              className="w-16 rounded-full border border-border bg-background px-2 py-0.5 text-[0.6875rem] text-foreground focus:ring-2 focus:ring-accent/40 focus:outline-none"
            />
            <span className="text-muted" aria-hidden>
              ×
            </span>
            <input
              type="number"
              min={MIN_CANVAS_HEIGHT}
              max={MAX_CANVAS_HEIGHT}
              value={options.canvasHeight}
              onChange={(e) => options.updateCanvasHeight(Number(e.target.value))}
              aria-label={t({ ru: "Высота холста, пикселей", en: "Canvas height, pixels" })}
              className="w-16 rounded-full border border-border bg-background px-2 py-0.5 text-[0.6875rem] text-foreground focus:ring-2 focus:ring-accent/40 focus:outline-none"
            />
          </div>

          <SliderRow
            id={options.cardSizeSliderId}
            label={t({ ru: "Размер карточек", en: "Card size" })}
            value={options.scale}
            min={MIN_OBS_SCALE}
            max={MAX_OBS_SCALE}
            step={5}
            onChange={options.setScale}
          />

          <SliderRow
            id={options.nameWidthSliderId}
            label={t({ ru: "Ширина имени", en: "Name width" })}
            value={options.nameScale}
            min={MIN_OBS_NAME_SCALE}
            max={MAX_OBS_NAME_SCALE}
            step={10}
            disabled={!options.showNames}
            onChange={options.setNameScale}
            hint={t({
              ru: "Ниже ~130% имена почти всегда обрезаются даже с переносом на 2 строки.",
              en: "Below ~130%, names get cut off almost every time even with 2-line wrapping.",
            })}
          />
        </div>
      )}

      {/* The overlay's only motion, so it gets a real choice rather than
          being fixed. Named for what a viewer sees, not for the transform. */}
      <div className="mt-1" onMouseLeave={() => setPreviewing(null)}>
        <span className="text-xs font-medium text-muted">
          {t({ ru: "Появление билда", en: "Build entrance" })}
        </span>
        <div
          role="radiogroup"
          aria-label={t({ ru: "Появление билда", en: "Build entrance" })}
          className="mt-1.5 flex flex-wrap gap-1.5"
        >
          {OBS_ENTRANCES.map((id) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={options.entrance === id}
              data-testid={`obs-entrance-${id}`}
              onClick={() => options.setEntrance(id)}
              onMouseEnter={() => setPreviewing(id)}
              onFocus={() => setPreviewing(id)}
              onBlur={() => setPreviewing(null)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                options.entrance === id
                  ? "border-accent bg-accent/10 text-accent"
                  : "border-border text-muted hover:bg-surface-hover hover:text-foreground",
              )}
            >
              {t(ENTRANCE_LABEL[id])}
            </button>
          ))}
        </div>
        {/* Shows whatever is under the cursor, falling back to the chosen
            one — so the panel always answers "what does mine look like?"
            without needing a hover. */}
        <EntrancePreview entrance={previewing ?? options.entrance} />
      </div>

      <SkinPicker
        label={t({ ru: "Фон", en: "Background" })}
        value={options.background}
        onChange={options.setBackground}
        choices={[
          { id: "transparent", label: { ru: "Прозрачный", en: "Transparent" } },
          { id: "dark", label: { ru: "Тёмный", en: "Dark" } },
          { id: "vortex", label: { ru: "Вихрь", en: "Vortex" } },
          { id: "slots", label: { ru: "Слоты", en: "Slots" } },
        ]}
      />

      {/* Only meaningful for the Vortex, which is the only animated skin. */}
      {options.background === "vortex" && (
        <ToggleSwitch
          checked={options.motion === "still"}
          onChange={() => options.setMotion(options.motion === "still" ? "live" : "still")}
          label={t({ ru: "Неподвижный вихрь", en: "Still vortex" })}
          tooltip={t({
            ru: "Одна картинка на билд вместо живого шейдера. Стоит почти ничего — включите, если анимация нагружает кодировщик.",
            en: "One picture per build instead of a live shader. Costs next to nothing — turn it on if the animation is loading your encoder.",
          })}
        />
      )}

      <SkinPicker
        label={t({ ru: "Рамка карточек", en: "Card frame" })}
        value={options.frame}
        onChange={options.setFrame}
        choices={[
          { id: "plain", label: { ru: "Без рамки", en: "None" } },
          { id: "ritual", label: { ru: "Ритуал", en: "Ritual" } },
          { id: "slots", label: { ru: "Слоты", en: "Slots" } },
        ]}
      />

      <div className="mt-1 flex flex-col gap-3">
        <ToggleSwitch
          checked={options.showNames}
          onChange={options.toggleShowNames}
          label={t({ ru: "Показывать названия карточек", en: "Show card names" })}
        />
        <ToggleSwitch
          checked={options.showCharacter}
          onChange={options.toggleShowCharacter}
          label={t({ ru: "Показывать портрет персонажа", en: "Show character portrait" })}
          tooltip={t({
            ru: "Появляется только если билд привязан к персонажу — выбран вручную или для убийцы определён по аддонам.",
            en: "Only shows up when the build has a known character — picked manually, or figured out from a killer's rolled add-ons.",
          })}
        />
      </div>

      <PieceVisibilityChips
        mode={mode}
        pieceVisibility={pieceVisibility}
        onChange={onPieceVisibilityChange}
      />
    </div>
  );
}

function PresetButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-full border px-2 py-1.5 text-[0.6875rem] font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none",
        active
          ? "border-accent/50 bg-accent/15 text-accent"
          : "border-border text-muted hover:bg-surface-hover hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
}

function SliderRow({
  id,
  label,
  value,
  min,
  max,
  step,
  disabled = false,
  onChange,
  hint,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  disabled?: boolean;
  onChange: (value: number) => void;
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={id} className={cn("text-xs font-medium text-muted", disabled && "opacity-40")}>
          {label}
        </label>
        <span className={cn("text-[0.6875rem] tabular-nums text-muted", disabled && "opacity-40")}>
          {value}%
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label}
        className="w-full accent-accent"
      />
      {hint && <p className="text-[0.6875rem] text-muted">{hint}</p>}
    </div>
  );
}

/** Which kinds reach the overlay and Download Image — deliberately separate
 *  from the slot toggles that decide what gets *rolled*. */
function PieceVisibilityChips({
  mode,
  pieceVisibility,
  onChange,
}: {
  mode: "perks" | "loadout" | "all";
  pieceVisibility: PieceVisibility;
  onChange: (kind: keyof PieceVisibility, value: boolean) => void;
}) {
  const t = useT();
  const kinds = (
    [
      ["perks", { ru: "Перки", en: "Perks" }, mode !== "loadout"],
      ["item", { ru: "Предмет", en: "Item" }, mode !== "perks"],
      ["addon", { ru: "Аддоны", en: "Add-ons" }, mode !== "perks"],
      ["offering", { ru: "Подношение", en: "Offering" }, mode !== "perks"],
    ] as const
  ).filter(([, , relevant]) => relevant);

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted">{t({ ru: "Показывать:", en: "Show:" })}</span>
      <div
        className="flex flex-wrap gap-1.5"
        role="group"
        aria-label={t({
          ru: "Какие элементы билда показывать в оверлее и на скачанной картинке",
          en: "Which build pieces to show in the overlay and in the downloaded image",
        })}
      >
        {kinds.map(([kind, label]) => (
          <button
            key={kind}
            type="button"
            aria-pressed={pieceVisibility[kind]}
            onClick={() => onChange(kind, !pieceVisibility[kind])}
            className={cn(
              "rounded-full border px-2.5 py-1 text-[0.6875rem] font-medium transition-colors",
              pieceVisibility[kind]
                ? "border-accent/50 bg-accent/15 text-accent"
                : "border-border text-muted/50 hover:bg-surface-hover hover:text-foreground",
            )}
          >
            {t(label)}
          </button>
        ))}
      </div>
      <p className="text-[0.6875rem] text-muted">
        {t({
          ru: "Не влияет на то, что реально выпадает — только на то, что видно в оверлее и на картинке.",
          en: "Doesn't change what actually gets rolled — only what's visible in the overlay and the downloaded image.",
        })}
      </p>
    </div>
  );
}

/** A small segmented control. The skins are a choice among a handful of named
 *  looks, not a switch — a row of pills says that where a toggle could not. */
function SkinPicker<T extends string>({
  label,
  value,
  onChange,
  choices,
}: {
  label: string;
  value: T;
  onChange: (next: T) => void;
  choices: ReadonlyArray<{ id: T; label: { ru: string; en: string } }>;
}) {
  const t = useT();
  return (
    <div className="mt-1 flex flex-col gap-1.5">
      <span className="text-[0.6875rem] font-medium text-muted">{label}</span>
      <div
        role="radiogroup"
        aria-label={label}
        className="flex flex-wrap gap-1 rounded-full border border-border bg-background/40 p-1"
      >
        {choices.map((choice) => {
          const active = choice.id === value;
          return (
            <button
              key={choice.id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(choice.id)}
              className={cn(
                "tap flex-1 rounded-full px-2.5 py-1 text-[0.6875rem] font-medium whitespace-nowrap transition-colors",
                active
                  ? "bg-accent text-accent-foreground"
                  : "text-muted hover:bg-surface-hover hover:text-foreground",
              )}
            >
              {t(choice.label)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
