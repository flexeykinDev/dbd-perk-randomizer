import type { Perk } from "./types";
import type { Lang } from "./i18n";

export interface PerkDescriptionView {
  /** Brief bulleted summary of the mechanical effect, "**"-highlighted. */
  core: string[];
  /** Full descriptive text, "**"-highlighted, quote stripped out. */
  full: string;
  /** Trailing lore quote, if any (already formatted for display). */
  quote: string | null;
  /** True when this came from a hand-authored translation rather than
   *  being auto-derived from the scraped English text. */
  curated: boolean;
}

// Scraped descriptions end with `"quote text" — Speaker Name`, glued
// directly onto the mechanical text with no other separator.
const QUOTE_RE = /"([^"]+)"\s*[-—]\s*(.+)\s*$/;

function splitQuote(text: string, lang: Lang): { body: string; quote: string | null } {
  const match = text.match(QUOTE_RE);
  if (!match || match.index === undefined) return { body: text.trim(), quote: null };
  const body = text.slice(0, match.index).trim();
  const quoted = lang === "ru" ? `«${match[1]}»` : `“${match[1]}”`;
  return { body, quote: `${quoted} — ${match[2].trim()}` };
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!])\s+(?=[A-ZА-ЯЁ])/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

// Tiered values (6/7/8) before bare numbers so "6/7/8 seconds" highlights as
// one span instead of three separate digits.
const VALUE_RE =
  /\d+(?:\/\d+)+(?:\s?(?:metres?|meters?|m|seconds?|sec|s|%))?|\d+(?:[.,]\d+)?\s?(?:metres?|meters?|m\b|seconds?|sec\b|секунд[а-я]*|метр[а-я]*|%)|\d+(?:[.,]\d+)?%/gi;

function autoHighlight(text: string): string {
  return text.replace(VALUE_RE, (match) => `**${match}**`);
}

export function getPerkDescription(perk: Perk, lang: Lang): PerkDescriptionView {
  if (lang === "ru" && perk.descriptionRu) {
    return {
      full: perk.descriptionRu.full,
      core: perk.descriptionRu.core,
      quote: perk.descriptionRu.quote ?? null,
      curated: true,
    };
  }

  // No hand-curated entry — auto-derive from raw text, same split/highlight
  // treatment either way. Prefer the RU wiki's own description text
  // (scripts/sync-descriptions.ts) over the English one when available, so
  // RU mode isn't silently reading English for slugs nobody's hand-curated
  // yet.
  const source = lang === "ru" && perk.descriptionRuRaw ? perk.descriptionRuRaw : perk.description;
  const { body, quote } = splitQuote(source, lang);
  return {
    full: autoHighlight(body),
    core: splitSentences(body).map(autoHighlight),
    quote,
    curated: false,
  };
}
