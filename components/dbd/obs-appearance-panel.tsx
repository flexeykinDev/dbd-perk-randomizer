"use client";

import { cn } from "@/lib/cn";
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
} from "@/lib/use-obs-mode";
import { ToggleSwitch } from "./toggle-switch";

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
        <p className="-mt-1 text-[11px] text-muted">{t(options.activePresetDescription)}</p>
      )}

      {options.styleMode === "custom" && (
        <div className="flex flex-col gap-4 rounded-lg border border-border bg-background/40 p-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <label htmlFor={options.canvasWidthId} className="text-[11px] text-muted">
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
              className="w-16 rounded-full border border-border bg-background px-2 py-0.5 text-[11px] text-foreground focus:ring-2 focus:ring-accent/40 focus:outline-none"
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
              className="w-16 rounded-full border border-border bg-background px-2 py-0.5 text-[11px] text-foreground focus:ring-2 focus:ring-accent/40 focus:outline-none"
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

      <div className="mt-1 flex flex-col gap-3">
        <ToggleSwitch
          checked={options.showNames}
          onChange={options.toggleShowNames}
          label={t({ ru: "Показывать названия карточек", en: "Show card names" })}
        />
        <ToggleSwitch
          checked={options.darkBg}
          onChange={options.toggleDarkBg}
          label={t({
            ru: "Тёмный фон вместо прозрачного",
            en: "Dark background instead of transparent",
          })}
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
        "rounded-full border px-2 py-1.5 text-[11px] font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none",
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
        <span className={cn("text-[11px] tabular-nums text-muted", disabled && "opacity-40")}>
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
      {hint && <p className="text-[11px] text-muted">{hint}</p>}
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
              "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
              pieceVisibility[kind]
                ? "border-accent/50 bg-accent/15 text-accent"
                : "border-border text-muted/50 hover:bg-surface-hover hover:text-foreground",
            )}
          >
            {t(label)}
          </button>
        ))}
      </div>
      <p className="text-[11px] text-muted">
        {t({
          ru: "Не влияет на то, что реально выпадает — только на то, что видно в оверлее и на картинке.",
          en: "Doesn't change what actually gets rolled — only what's visible in the overlay and the downloaded image.",
        })}
      </p>
    </div>
  );
}
