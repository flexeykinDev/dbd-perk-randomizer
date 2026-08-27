"use client";

import { useEffect } from "react";
import { VideoEmbed } from "@/components/video-embed";
import { RandomizerBoard } from "@/components/dbd/randomizer-board";
import { ObsOverlay } from "@/components/dbd/obs-overlay";
import { perksMeta } from "@/lib/perks";
import { useLanguage, useT } from "@/lib/i18n";
import { useIsObsMode } from "@/lib/use-obs-mode";
import { registerServiceWorker } from "@/lib/register-sw";
import { printConsoleBranding } from "@/lib/console-branding";
import trailer from "@/data/trailer.json";

export function RandomizerContent() {
  const t = useT();
  const { lang } = useLanguage();
  const isObsMode = useIsObsMode();

  useEffect(() => {
    registerServiceWorker();
    printConsoleBranding();
  }, []);
  const updatedAt = new Date(perksMeta.scrapedAt).toLocaleDateString(
    lang === "ru" ? "ru-RU" : "en-US",
    { year: "numeric", month: "long", day: "numeric" },
  );

  if (isObsMode) return <ObsOverlay />;

  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <div>
        <h1 className="text-[clamp(1.25rem,3vw+0.75rem,2.25rem)] font-semibold tracking-tight text-balance">
          {t({
            ru: "Dead by Daylight — Рандомайзер Перков",
            en: "Dead by Daylight — Perk Randomizer",
          })}
        </h1>
        <p className="mt-1.5 text-xs text-muted sm:text-sm">
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
  );
}
