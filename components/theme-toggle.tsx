"use client";

import { useState } from "react";
import { Grid2x2, Moon, Sun } from "lucide-react";
import { useMounted } from "@/lib/use-mounted";
import { isTheme, nextTheme, THEME_STORAGE_KEY, type Theme } from "@/lib/theme";
import { useT } from "@/lib/i18n";
import { safeSet } from "@/lib/safe-storage";

function readTheme(): Theme {
  if (typeof document === "undefined") return "dark";
  const stored = document.documentElement.dataset.theme;
  return isTheme(stored) ? stored : "dark";
}

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  safeSet("local", THEME_STORAGE_KEY, theme);
}

/* Where the next press goes. This is the TITLE, not the accessible name.
 *
 * It was the aria-label at first, on the grounds that a Sun icon on a dark page
 * is ambiguous about whether it describes now or next. That was worse: a
 * control whose accessible name changes on every press reads as a different
 * button each time to a screen reader, and it broke every test that found this
 * by name. The name stays "Переключить тему" and the destination rides along in
 * the tooltip, where it helps without renaming anything. */
const NEXT_LABEL: Record<Theme, { ru: string; en: string }> = {
  dark: { ru: "Светлая тема", en: "Light theme" },
  light: { ru: "Пиксельная тема", en: "Pixel theme" },
  pixel: { ru: "Тёмная тема", en: "Dark theme" },
};

export function ThemeToggle() {
  const t = useT();
  const mounted = useMounted();
  const [theme, setTheme] = useState<Theme>(readTheme);
  /* Before mount the markup must match the server's, which always renders the
     dark default — so the icon only follows the real theme once hydrated, the
     same rule every other persisted control here follows. */
  const current: Theme = mounted ? theme : "dark";

  function cycle() {
    const next = nextTheme(theme);
    setTheme(next);
    applyTheme(next);
  }

  const name = t({ ru: "Переключить тему", en: "Switch theme" });
  const destination = t(NEXT_LABEL[current]);
  const Icon = current === "dark" ? Sun : current === "light" ? Grid2x2 : Moon;

  return (
    <button
      type="button"
      onClick={cycle}
      aria-label={name}
      title={`${name} — ${destination}`}
      className="tap-square flex size-9 shrink-0 items-center justify-center rounded-full border border-border text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
    >
      <Icon className="size-4" />
    </button>
  );
}
