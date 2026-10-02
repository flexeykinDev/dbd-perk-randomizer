"use client";

import { Dropdown } from "./dropdown";
import { useT } from "@/lib/i18n";
import type { BuildMode } from "@/lib/types";

/**
 * What the roll produces: perks, a full loadout, or both.
 *
 * This is the one control that came back out of the setup disclosure, and the
 * reasoning is worth keeping because it cuts against the rest of this
 * redesign. Everything else moved inside on the grounds that the defaults
 * answer it well enough — four perks, every slot on, no theme. Mode has no
 * such default: Full Loadout is not a setting on the thing you came for, it
 * is a different thing to come for, and a feature nobody can see is a feature
 * nobody uses. Hiding it bought one control's worth of quiet and risked the
 * whole half of the product that rolls items, add-ons and offerings.
 *
 * So it is out here, but as ONE control rather than the three pills it used to
 * be, and quiet rather than coloured — the same shape the perk count took. The
 * board goes from eight things above the build to nine, not eleven, and the
 * options carry hints, so opening it is also how you find out what "Всё" means
 * without having to try it.
 */
export function ModeSelect({
  value,
  onChange,
}: {
  value: BuildMode;
  onChange: (next: BuildMode) => void;
}) {
  const t = useT();

  return (
    <Dropdown
      value={value}
      onChange={(v) => onChange(v as BuildMode)}
      label={t({ ru: "Что генерировать", en: "What to roll" })}
      className="border-border bg-surface/60 text-foreground"
      options={[
        {
          value: "perks",
          label: t({ ru: "Перки", en: "Perks" }),
          hint: t({ ru: "Только перки", en: "Perks only" }),
        },
        {
          value: "loadout",
          label: t({ ru: "Экипировка", en: "Full Loadout" }),
          hint: t({
            ru: "Предмет, аддоны и подношение",
            en: "Item, add-ons and offering",
          }),
        },
        {
          value: "all",
          label: t({ ru: "Всё", en: "Both" }),
          hint: t({ ru: "Перки и экипировка", en: "Perks and loadout" }),
        },
      ]}
    />
  );
}
