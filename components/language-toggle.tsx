"use client";

import { useLanguage } from "@/lib/i18n";

export function LanguageToggle() {
  const { lang, setLang } = useLanguage();

  return (
    <button
      type="button"
      onClick={() => setLang(lang === "ru" ? "en" : "ru")}
      aria-label="Switch language / Переключить язык"
      title="Switch language / Переключить язык"
      className="flex h-9 shrink-0 items-center justify-center rounded-full border border-border px-3 text-xs font-semibold text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
    >
      {lang === "ru" ? "RU" : "EN"}
    </button>
  );
}
