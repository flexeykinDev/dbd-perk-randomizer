"use client";

import { ControlGroup, ControlPanel } from "./control-panel";
import { ROLE_COLOR } from "@/lib/role-color";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n";
import type { LoadoutSlots, PerkRole } from "@/lib/types";

/**
 * Which loadout slots get rolled.
 *
 * Rendered only in the two modes that roll a loadout, which is why it is a
 * panel of its own rather than a segment in a permanent toolbar: in the
 * default Perks mode there is nothing here to say, and a bordered box holding
 * one control was most of what made the board look busy on arrival.
 *
 * This used to also carry the perk count and Battle Royale. The count became
 * its own one-line control beside the mode switch (perk-count-select.tsx) and
 * Battle Royale moved into the setup disclosure, because a whole alternate
 * game mode most visitors never start is not something to put in front of
 * them before their first roll.
 */
export function LoadoutSlotsPanel({
  role,
  loadoutSlots,
  onToggleLoadoutSlot,
}: {
  role: PerkRole;
  loadoutSlots: LoadoutSlots;
  onToggleLoadoutSlot: (slot: keyof LoadoutSlots) => void;
}) {
  const t = useT();
  const roleColor = ROLE_COLOR[role];

  return (
    <ControlPanel>
      <ControlGroup label={t({ ru: "Слоты:", en: "Slots:" })}>
        {(
          [
            ["item", { ru: "Предмет", en: "Item" }],
            ["addons", { ru: "Аддоны", en: "Add-ons" }],
            ["offering", { ru: "Подношение", en: "Offering" }],
          ] as const
        )
          // The killer's is a Power, which they always have — nothing to turn
          // off.
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
    </ControlPanel>
  );
}
