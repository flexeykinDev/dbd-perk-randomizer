"use client";

import { plural, useT } from "@/lib/i18n";
import type { StreakState } from "@/lib/daily-streak";

/** Days running on the Daily Challenge, beside the shared head count.
 *
 *  The two numbers next to each other say different things on purpose: one
 *  is how many people took today's challenge, the other is how many days in
 *  a row you have. The first comes from Firebase, the second never leaves
 *  this browser.
 *
 *  Renders nothing at zero. A player on their first ever day has a streak of
 *  1, so a 0 means either "has never taken it" or "the run ended while they
 *  were away" — and neither is worth telling someone about the moment they
 *  open the feature. */
export function DailyStreak({ streak }: { streak: StreakState }) {
  const t = useT();
  if (streak.current <= 0) return null;

  const { current, longest } = streak;
  // The record is only worth showing once it is genuinely behind you. While
  // the current run *is* the record, saying so twice is noise.
  const showBest = longest > current;

  return (
    <>
      {" · "}
      <span className="text-foreground">
        {t({
          ru: `${current} ${plural("ru", current, { one: "день", few: "дня", other: "дней" })} подряд`,
          en: `${current} ${current === 1 ? "day" : "days"} in a row`,
        })}
      </span>
      {showBest && (
        <span className="text-muted">
          {t({ ru: ` (рекорд ${longest})`, en: ` (best ${longest})` })}
        </span>
      )}
    </>
  );
}
