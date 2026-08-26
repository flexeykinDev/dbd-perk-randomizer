"use client";

import { useT } from "@/lib/i18n";

/* "Pool stats" — how big the pool is, how much of it you have ruled out, and
 * (in Battle Royale) how much is left.
 *
 * There are two of these, one for perks and one for loadout pieces, and they
 * were two near-identical fifty-line blocks inside RandomizerBoard's render.
 * Only the wording of the first line and which numbers go in differ, so those
 * are the props and everything else is shared. The Battle Royale line is
 * absent rather than zeroed when the mode is off — there is no run to report
 * on.
 */
export function PoolStatsPanel({
  totalLabel,
  total,
  excluded,
  battleRoyale,
}: {
  /** Already-localized "Total survivor perks:" style label — the two callers
   *  word it differently enough that composing it here would be worse. */
  totalLabel: string;
  total: number;
  excluded: number;
  /** Omitted when the mode is off. Both numbers are filtered to the current
   *  role: the eliminated set spans both roles, so a raw count would
   *  disagree with the `remaining` sitting beside it. */
  battleRoyale?: { usedInRole: number; remaining: number };
}) {
  const t = useT();
  return (
    <div className="rounded-xl border border-border bg-surface px-4 py-3 text-center text-xs text-muted">
      <p>
        {totalLabel} <b className="text-foreground">{total}</b>
      </p>
      <p>
        {t({ ru: "Исключено вручную:", en: "Manually excluded:" })}{" "}
        <b className="text-foreground">{excluded}</b>
      </p>
      {battleRoyale && (
        <p>
          {t({ ru: "Использовано в Battle Royale:", en: "Used in Battle Royale:" })}{" "}
          <b className="text-foreground">{battleRoyale.usedInRole}</b> ·{" "}
          {t({ ru: "Осталось:", en: "Remaining:" })}{" "}
          <b className="text-foreground">{battleRoyale.remaining}</b>
        </p>
      )}
    </div>
  );
}
