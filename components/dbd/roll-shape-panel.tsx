"use client";

import { BattleRoyaleControl } from "./battle-royale-control";
import { ControlGroup, ControlPanel } from "./control-panel";
import { MAX_PERK_COUNT } from "@/lib/use-board-settings";
import { ROLE_COLOR } from "@/lib/role-color";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n";
import type { BuildMode, LoadoutSlots, PerkRole } from "@/lib/types";

/**
 * What shape the next roll has: how many perks, which loadout slots, and
 * whether the pool shrinks as you go.
 *
 * Together with the role pills and the mode segment above it, this is the
 * primary toolbar. The test these controls pass and nothing else does is that
 * changing one changes what the NEXT roll produces, and you change them
 * between rolls. Theme and coherence also change the roll but are set once a
 * session, so they went into the disclosure with the rest of the setup — see
 * setup-panel.tsx.
 *
 * Each segment hides itself in the mode it has nothing to say about, so the
 * panel is never a row of controls that do not apply.
 */
export function RollShapePanel({
  mode,
  role,
  perkCount,
  loadoutSlots,
  battleRoyale,
  availableCount,
  onSelectPerkCount,
  onToggleBattleRoyale,
  onToggleLoadoutSlot,
}: {
  mode: BuildMode;
  role: PerkRole;
  perkCount: number;
  loadoutSlots: LoadoutSlots;
  battleRoyale: boolean;
  /** Already filtered to the current role — see lib/use-battle-royale.ts for
   *  why a raw count would disagree with the pool size sitting beside it. */
  availableCount: number;
  onSelectPerkCount: (n: number) => void;
  onToggleBattleRoyale: () => void;
  onToggleLoadoutSlot: (slot: keyof LoadoutSlots) => void;
}) {
  const t = useT();
  const roleColor = ROLE_COLOR[role];

  return (
    <ControlPanel>
      {mode !== "loadout" && (
        <ControlGroup label={t({ ru: "Перков:", en: "Perks:" })}>
          {Array.from({ length: MAX_PERK_COUNT + 1 }, (_, n) => n).map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => onSelectPerkCount(n)}
              className={cn(
                "tap-square flex size-7 items-center justify-center rounded-full border text-control font-semibold transition-colors",
                perkCount === n
                  ? cn(roleColor.border, roleColor.bg, roleColor.text)
                  : "border-border text-muted hover:bg-surface-hover hover:text-foreground",
              )}
            >
              {n}
            </button>
          ))}
        </ControlGroup>
      )}

      {/* A whole game mode, so it belongs with the controls that decide what
          gets rolled rather than below the keyboard legend, which is where it
          used to be. */}
      <BattleRoyaleControl
        active={battleRoyale}
        onToggle={onToggleBattleRoyale}
        remaining={availableCount}
      />

      {mode !== "perks" && (
        <ControlGroup label={t({ ru: "Слоты:", en: "Slots:" })}>
          {(
            [
              ["item", { ru: "Предмет", en: "Item" }],
              ["addons", { ru: "Аддоны", en: "Add-ons" }],
              ["offering", { ru: "Подношение", en: "Offering" }],
            ] as const
          )
            // The killer's slot is a Power, which they always have — there is
            // nothing to turn off.
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
  );
}
