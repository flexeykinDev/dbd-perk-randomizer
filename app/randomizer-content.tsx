"use client";

import { useEffect } from "react";
import { MotionConfig } from "framer-motion";
import { VideoEmbed } from "@/components/video-embed";
import { RandomizerBoard } from "@/components/dbd/randomizer-board";
import { ObsOverlay } from "@/components/dbd/obs-overlay";
import { perksMeta } from "@/lib/perks";
import { useLanguage, useT } from "@/lib/i18n";
import { useIsObsMode } from "@/lib/use-obs-mode";
import { useIsEmbedMode } from "@/lib/use-embed-mode";
import { useIsStreamMode } from "@/lib/use-stream-mode";
import { EmbedView } from "@/components/dbd/embed-view";
import { StreamView } from "@/components/dbd/stream-view";
import { registerServiceWorker } from "@/lib/register-sw";
import { printConsoleBranding } from "@/lib/console-branding";
import trailer from "@/data/trailer.json";

export function RandomizerContent() {
  const t = useT();
  const { lang } = useLanguage();
  const isObsMode = useIsObsMode();
  const isEmbedMode = useIsEmbedMode();
  const isStreamMode = useIsStreamMode();

  useEffect(() => {
    // Not in an embed. The service worker is for the installed app, and
    // registering it from an iframe on a stranger's page would start
    // caching this origin for a visitor who never came here. The manifest's
    // start_url is "/" and carries no hash, so it was never at risk of
    // pointing at the embed.
    if (!isEmbedMode) registerServiceWorker();
    printConsoleBranding();
  }, [isEmbedMode]);
  const updatedAt = new Date(perksMeta.scrapedAt).toLocaleDateString(
    lang === "ru" ? "ru-RU" : "en-US",
    { year: "numeric", month: "long", day: "numeric" },
  );

  if (isObsMode) return <ObsOverlay />;
  if (isEmbedMode) return <EmbedView />;
  // After the overlay and the embed: those two are what a Browser Source
  // and an iframe load, and neither may ever resolve to a setup page.
  if (isStreamMode) return <StreamView />;

  return (
    /* framer-motion is driven by JS and never sees the CSS media query, so
       the card entrances, the stage reveals and every AnimatePresence in the
       app would keep springing. `reducedMotion="user"` makes the library
       honour the system preference everywhere at once — the alternative was
       a useReducedMotion call in each of a dozen components, which is a rule
       somebody forgets on the thirteenth. */
    <MotionConfig reducedMotion="user">
    <div className="flex flex-col items-center gap-2 text-center sm:gap-3">
      <div>
        {/* The clamp's floor was 1.25rem, which wrapped this to two lines on a
            390px phone and cost 71px of the first screen — on the device where
            the first screen is scarcest. 1.05rem fits it to one line there and
            changes nothing from `sm` up, where 3vw has already overtaken it. */}
        <h1 className="text-[clamp(1.05rem,3vw+0.75rem,2.25rem)] font-semibold tracking-tight text-balance">
          {t({
            ru: "Dead by Daylight — Рандомайзер Перков",
            en: "Dead by Daylight — Perk Randomizer",
          })}
        </h1>
        <p className="mt-1.5 text-hint text-muted">
          {t({
            ru: `${perksMeta.survivorCount} перков выживших · ${perksMeta.killerCount} перков убийц · обновлено ${updatedAt} с`,
            en: `${perksMeta.survivorCount} survivor perks · ${perksMeta.killerCount} killer perks · updated ${updatedAt} from the`,
          })}{" "}
          <a
            href={perksMeta.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="underline decoration-dotted underline-offset-4 hover:text-accent"
          >
            {t({ ru: "официальной wiki", en: "official wiki" })}
          </a>
        </p>
      </div>

      <RandomizerBoard />

      {/* Below the board, not above it.
       *
       * The trailer is a 16:9 block that filled the first screen, and it put
       * the build and the Generate button underneath it: measured, the cards
       * started at 841px and Generate at 1115px, so on a 1366x768 laptop you
       * landed on this page and could see neither. The one thing people come
       * here to do was never on screen.
       *
       * It is still here, still collapsible, still remembers being hidden —
       * it just comes after the thing the page is for. */}
      <div className="mt-6 w-full">
        <VideoEmbed src={trailer.embedUrl} title={trailer.title} />
      </div>
    </div>
    </MotionConfig>
  );
}
