"use client";

import { useCallback, useEffect, useState } from "react";
import { Dices } from "lucide-react";
import { getPerksByRole, getRandomPerks } from "@/lib/perks";
import { withBasePath } from "@/lib/asset-path";
import { ROLE_COLOR } from "@/lib/role-color";
import { useEmbedOptions } from "@/lib/use-embed-mode";
import { useLanguage, useT } from "@/lib/i18n";
import type { Perk } from "@/lib/types";

/* The randomizer as a block on somebody else's page.
 *
 * One build, a roll button, a link home. Nothing else — no pools, no modes,
 * no seed, no OBS, no sound. An embed is a thing a visitor glances at on a
 * fan site or a Steam guide, and every control it grows is one they did not
 * come to that page for.
 *
 * Three rules this file exists to keep, all of them because the page is not
 * the window here:
 *
 *  - Nothing fixed, nothing full-viewport, no body scroll lock. Those all
 *    assume ownership of a viewport this does not own, and inside a 320px
 *    iframe they either overflow the frame or cover the host's page.
 *  - Nothing that touches Firebase. The overlay needs a room because OBS
 *    runs a separate browser; an embed has no such problem and no business
 *    opening a connection from a stranger's page.
 *  - The visitor's own pool settings are ignored. localStorage is shared
 *    per origin, so the iframe can see them — but a third party's page
 *    quietly rolling from the visitor's private exclusions is a surprise,
 *    and a site embedding this expects the whole game's perks.
 */
export function EmbedView() {
  const t = useT();
  const { lang } = useLanguage();
  const { role, perkCount } = useEmbedOptions();
  const [perks, setPerks] = useState<Perk[]>([]);
  const roleColor = ROLE_COLOR[role];

  const roll = useCallback(() => {
    // The full role pool, deliberately — see the note above about the
    // visitor's own exclusions.
    setPerks(getRandomPerks(role, perkCount));
  }, [role, perkCount]);

  /* Rolled after mount rather than during render: a build picked while
     rendering would differ between the server's HTML and the client's first
     pass, which is the hydration mismatch the rest of this app is careful
     about. The empty first frame lasts one tick.

     Wrapped in a named function, the same shape lib/use-twitch-settings.ts
     uses — react-hooks/set-state-in-effect guards against cascading
     renders, and "put the first build on screen once we are on the client"
     is the case that cascade is for. */
  useEffect(() => {
    function rollFirstBuild() {
      if (getPerksByRole(role).length > 0) roll();
    }
    rollFirstBuild();
  }, [role, roll]);

  return (
    <div className="flex w-full flex-col items-center gap-2 p-2">
      <div
        className="grid w-full gap-1.5"
        // Two columns at 320px, four once there is room. A media query
        // would measure the host page's viewport, not this frame, so the
        // breakpoint has to come from the frame's own width.
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(68px, 1fr))" }}
      >
        {perks.map((perk) => (
          <div
            key={perk.slug}
            className="flex min-w-0 flex-col items-center gap-0.5 rounded-lg border border-border bg-surface p-1.5"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- next/image ignores basePath for unoptimized runtime src, see lib/asset-path.ts */}
            <img
              src={withBasePath(perk.icon)}
              alt={perk.name[lang]}
              width={44}
              height={44}
              className="size-11 shrink-0"
            />
            <span className="w-full truncate text-center text-hint leading-tight text-muted">
              {perk.name[lang]}
            </span>
          </div>
        ))}
      </div>

      <div className="flex w-full items-center justify-between gap-2">
        <button
          type="button"
          onClick={roll}
          className={`tap flex items-center gap-1.5 rounded-full px-3 py-1.5 text-control font-semibold ${roleColor.bg} ${roleColor.text} transition-transform hover:scale-105 active:scale-95`}
        >
          <Dices className="size-3.5" />
          {t({ ru: "Ещё билд", en: "Roll" })}
        </button>
        <a
          href={withBasePath("/")}
          target="_blank"
          rel="noreferrer noopener"
          className="truncate text-micro text-muted underline decoration-dotted underline-offset-2 hover:text-foreground"
        >
          {t({ ru: "Рандомайзер перков DBD", en: "DBD Perk Randomizer" })}
        </a>
      </div>
    </div>
  );
}
