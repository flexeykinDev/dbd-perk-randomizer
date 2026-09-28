"use client";

import { useDailyCount } from "@/lib/daily-count";
import { plural, useT } from "@/lib/i18n";

/** How many players have taken today's Daily Challenge.
 *
 *  A component of its own purely so that mounting it is what opens the
 *  Firebase listener (see lib/daily-count.ts): rendering it only while the
 *  Daily Challenge is the active mode means a visitor who never opens the
 *  feature never opens a connection for it. Inlining the hook in the board
 *  would have subscribed everybody, always.
 *
 *  Renders nothing until there is a number — Firebase being unavailable,
 *  the read being denied, and the UTC day having just rolled over all look
 *  the same from here, and none of them is worth a "0 players today". */
export function DailyCount() {
  const t = useT();
  const count = useDailyCount();
  if (count === null) return null;

  return (
    <>
      {" · "}
      <span className="text-foreground">
        {t({
          ru: `сегодня ${plural("ru", count, { one: "сыграл", other: "сыграли" })} ${count} ${plural("ru", count, { one: "игрок", few: "игрока", other: "игроков" })}`,
          en: `${count} ${count === 1 ? "player" : "players"} took it today`,
        })}
      </span>
    </>
  );
}
