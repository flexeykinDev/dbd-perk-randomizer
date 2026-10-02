"use client";

import { Dropdown } from "./dropdown";
import { MAX_PERK_COUNT } from "@/lib/use-board-settings";
import { useT } from "@/lib/i18n";

/**
 * How many perks the next roll produces.
 *
 * It used to be five pills — 0 1 2 3 4 — which is five of the twelve controls
 * standing between someone arriving and their first build, to answer a
 * question almost nobody has. Four is the number of perk slots the game gives
 * you; the other four values are a deliberate handicap, and a handicap is
 * worth two clicks.
 *
 * So it reads as its own answer rather than a row of options: the control says
 * "4 перка", which is the setting, not a menu of settings. The zero case keeps
 * a hint line, because "Без перков" looks like a broken state until you are
 * told it is a challenge.
 */
export function PerkCountSelect({
  value,
  onChange,
}: {
  value: number;
  onChange: (next: number) => void;
}) {
  const t = useT();

  const label = (n: number) =>
    n === 0
      ? t({ ru: "Без перков", en: "No perks" })
      : t({
          // Russian takes the genitive singular for 2-4, the nominative for 1.
          ru: `${n} ${n === 1 ? "перк" : "перка"}`,
          en: `${n} ${n === 1 ? "perk" : "perks"}`,
        });

  return (
    <Dropdown
      value={String(value)}
      onChange={(v) => onChange(Number(v))}
      label={t({ ru: "Сколько перков", en: "How many perks" })}
      className="border-border bg-surface/60 text-foreground"
      options={Array.from({ length: MAX_PERK_COUNT + 1 }, (_, n) => ({
        value: String(n),
        label: label(n),
        hint:
          n === 0
            ? t({ ru: "Режим испытания", en: "Challenge mode" })
            : undefined,
      }))}
    />
  );
}
