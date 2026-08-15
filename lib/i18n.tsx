"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useMounted } from "./use-mounted";
import { safeGet, safeSet } from "./safe-storage";

export type Lang = "ru" | "en";

const LANG_STORAGE_KEY = "dbd-randomizer:language";

// CIS/Slavic-adjacent locales that should default to Russian rather than
// English — Belarusian and Ukrainian browsers commonly ship without a
// dedicated translation and Russian reads better for that audience than
// English does; Kazakh is included for the same reason.
const RUSSIAN_LOCALE_PREFIXES = ["ru", "be", "uk", "kk"];

function detectSystemLanguage(): Lang {
  if (typeof navigator === "undefined") return "en";
  try {
    const primary = navigator.languages?.[0] ?? navigator.language ?? "";
    const lower = primary.toLowerCase();
    return RUSSIAN_LOCALE_PREFIXES.some((prefix) => lower.startsWith(prefix)) ? "ru" : "en";
  } catch {
    return "en";
  }
}

interface LanguageContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  // Static export means the server always renders the Russian default —
  // there's neither a per-request cookie nor the visitor's navigator object
  // to consult at build time. We accept a brief flash for returning
  // English-preferring visitors rather than a hydration mismatch: the first
  // client render matches the server (ru), then the real preference —
  // saved choice, else system-language detection — is applied right after
  // mount, same pattern as the board's other persisted state.
  const mounted = useMounted();
  const [lang, setLangState] = useState<Lang>("ru");

  useEffect(() => {
    function applyInitialLanguage() {
      const saved = safeGet("local", LANG_STORAGE_KEY);
      setLangState(saved === "ru" || saved === "en" ? saved : detectSystemLanguage());
    }
    applyInitialLanguage();
  }, []);

  useEffect(() => {
    if (mounted) document.documentElement.lang = lang;
  }, [mounted, lang]);

  function setLang(next: Lang) {
    setLangState(next);
    safeSet("local", LANG_STORAGE_KEY, next);
  }

  return (
    <LanguageContext.Provider value={{ lang: mounted ? lang : "ru", setLang }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("useLanguage must be used within a LanguageProvider");
  return ctx;
}

/** Inline translation helper — keeps copy next to its usage instead of a
 *  far-away dictionary that's easy to let drift out of sync. */
export function useT() {
  const { lang } = useLanguage();
  return function t(strings: { ru: string; en: string }): string {
    return strings[lang];
  };
}

/** Russian noun pluralization — picks the grammatically correct form for a
 *  count, unlike English's flat singular/plural split. E.g. for "perk":
 *  1 -> "перк" (one), 2-4 -> "перка" (few), 0/5-20/... -> "перков" (many). */
export function ruPlural(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}
