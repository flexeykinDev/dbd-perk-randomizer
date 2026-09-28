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

/** The forms a language might need. `other` is required because it is the
 *  only category every language has — English uses one/other, Russian
 *  one/few/many/other, Japanese other alone — so it is what anything
 *  unhandled falls back to. Nothing here can render undefined. */
export type PluralForms = Partial<Record<Intl.LDMLPluralRule, string>> & {
  other: string;
};

/* Built once per language and reused. Constructing an Intl.PluralRules is
 * not free, and these are called inside render for every card in a list. */
const pluralRules = new Map<string, Intl.PluralRules>();

function rulesFor(lang: string): Intl.PluralRules {
  let rules = pluralRules.get(lang);
  if (!rules) {
    rules = new Intl.PluralRules(lang);
    pluralRules.set(lang, rules);
  }
  return rules;
}

/**
 * Picks the grammatically correct noun form for a count.
 *
 * This replaced a hand-written Russian rule — `mod10 === 1 && mod100 !== 11`
 * and so on — which was correct for Russian and wrong for everything else,
 * in a module every component imports. Anyone adding a third language would
 * have had to either write a second such function or quietly accept English
 * plurals in their own text.
 *
 * Intl.PluralRules is the same data CLDR publishes and every browser this
 * site supports already carries it, so a new language needs no code at all:
 * it declares its forms at the call site and the runtime chooses between
 * them.
 *
 * @example
 *   plural("ru", n, { one: "перк", few: "перка", other: "перков" })
 *   plural("en", n, { one: "perk", other: "perks" })
 */
export function plural(lang: string, count: number, forms: PluralForms): string {
  // A non-finite count would throw inside Intl rather than degrade.
  if (!Number.isFinite(count)) return forms.other;
  try {
    return forms[rulesFor(lang).select(count)] ?? forms.other;
  } catch {
    // An unrecognised language tag is not worth a blank screen.
    return forms.other;
  }
}
