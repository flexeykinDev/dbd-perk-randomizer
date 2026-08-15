"use client";

import { useEffect } from "react";
import { VideoEmbed } from "@/components/video-embed";
import { RandomizerBoard } from "@/components/dbd/randomizer-board";
import { EasterEgg } from "@/components/dbd/easter-egg";
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
      <EasterEgg />
      <div>
        <h1 className="text-[clamp(1.5rem,3vw+1rem,2.25rem)] font-semibold tracking-tight">
          {t({
            ru: "Dead by Daylight — Рандомайзер Перков",
            en: "Dead by Daylight — Perk Randomizer",
          })}
        </h1>
        <p className="mt-1.5 text-sm text-muted">
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

      <VideoEmbed src={trailer.embedUrl} title={trailer.title} />

      <RandomizerBoard />
    </div>
  );
}
