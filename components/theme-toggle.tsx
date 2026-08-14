"use client";

import { useState } from "react";
import { Moon, Sun } from "lucide-react";
import { useMounted } from "@/lib/use-mounted";
import { THEME_STORAGE_KEY, type Theme } from "@/lib/theme";
import { useT } from "@/lib/i18n";

function readTheme(): Theme {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  window.localStorage.setItem(THEME_STORAGE_KEY, theme);
}

export function ThemeToggle() {
  const t = useT();
  const mounted = useMounted();
  const [theme, setTheme] = useState<Theme>(readTheme);
  const showLight = mounted && theme === "light";

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    applyTheme(next);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={t({ ru: "Переключить тему", en: "Switch theme" })}
      title={t({ ru: "Переключить тему", en: "Switch theme" })}
      className="flex size-9 shrink-0 items-center justify-center rounded-full border border-border text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
    >
      {showLight ? <Moon className="size-4" /> : <Sun className="size-4" />}
    </button>
  );
}
