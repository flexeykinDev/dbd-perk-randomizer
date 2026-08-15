"use client";

import Link from "next/link";
import { Dices, ArrowLeft } from "lucide-react";
import { useT } from "@/lib/i18n";
import { useIsObsMode } from "@/lib/use-obs-mode";
import { ThemeToggle } from "./theme-toggle";
import { LanguageToggle } from "./language-toggle";

const HUB_URL = "https://flexeykindev.github.io/Vortex-Hub/";

export function Nav() {
  const t = useT();
  const isObsMode = useIsObsMode();

  if (isObsMode) return null;

  return (
    <header className="border-b border-border/60">
      <nav className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-2.5">
        <Link href="/" className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Dices className="size-5 text-accent" strokeWidth={2} />
          {t({ ru: "Рандомайзер перков DBD", en: "DBD Perk Randomizer" })}
        </Link>
        <div className="flex items-center gap-2">
          <a
            href={HUB_URL}
            className="flex items-center gap-1.5 rounded-full border border-border px-3 py-2 text-xs font-medium text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" />
            {t({ ru: "Vortex Hub", en: "Vortex Hub" })}
          </a>
          <LanguageToggle />
          <ThemeToggle />
        </div>
      </nav>
    </header>
  );
}
