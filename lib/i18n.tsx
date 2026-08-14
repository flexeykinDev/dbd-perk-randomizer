"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useMounted } from "./use-mounted";

export type Lang = "ru" | "en";

const LANG_COOKIE = "dbd-randomizer-lang";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

function readLangCookie(): Lang | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(/(?:^|; )dbd-randomizer-lang=(ru|en)/);
  return match ? (match[1] as Lang) : null;
}

function writeLangCookie(lang: Lang) {
  document.cookie = `${LANG_COOKIE}=${lang}; max-age=${COOKIE_MAX_AGE}; path=/; samesite=lax`;
}

interface LanguageContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  // Static export means the server always renders the Russian default —
  // there's no per-request cookie to read at build time. We accept a brief
  // flash for returning English-preferring visitors rather than a hydration
  // mismatch: first client render matches the server (ru), then the cookie
  // is applied right after mount.
  const mounted = useMounted();
  const [lang, setLangState] = useState<Lang>("ru");

  useEffect(() => {
    function applyCookieLang() {
      const cookieLang = readLangCookie();
      if (cookieLang) setLangState(cookieLang);
    }
    applyCookieLang();
  }, []);

  useEffect(() => {
    if (mounted) document.documentElement.lang = lang;
  }, [mounted, lang]);

  function setLang(next: Lang) {
    setLangState(next);
    writeLangCookie(next);
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
