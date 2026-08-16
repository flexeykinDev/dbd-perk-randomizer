import type { LocalizedDescription } from "./types";
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

// A sentence that mentions a number, a percentage, or a quoted term (a
// named Status Effect, e.g. "Undetectable"/"Незаметность") reads as the
// actual game-mechanic text; one that doesn't is very likely flavor —
// several item/add-on wiki cells open with a flavor sentence glued
// directly onto the mechanical text with no separator other than the
// period (confirmed by hand, e.g. Filthy Slippers: "Max sometimes
// struggled to hear his mother's footfalls. Gain the Undetectable Status
// Effect..."). Works the same for RU raw text, which uses the same «/„
// quoting conventions for named effects.
const MECHANICAL_HINT_RE = /\d|%|["«»„“]/;

/** Drops a leading run of non-mechanical (flavor) sentences from the Core
 *  Effect bullets — the Full Text tab still shows everything verbatim, so
 *  nothing is actually lost, just kept out of the short summary. Only
 *  commits to dropping when something *after* the dropped prefix still
 *  looks mechanical; a description that never mentions a number/quoted
 *  term at all is left untouched rather than guessed at. */
function stripLoreIntro(sentences: string[]): string[] {
  if (sentences.length < 2) return sentences;
  let dropCount = 0;
  while (dropCount < sentences.length - 1 && !MECHANICAL_HINT_RE.test(sentences[dropCount])) {
    dropCount++;
  }
  if (dropCount === 0) return sentences;
  const remainder = sentences.slice(dropCount);
  return remainder.some((s) => MECHANICAL_HINT_RE.test(s)) ? remainder : sentences;
}

// Tiered values (6/7/8) before bare numbers so "6/7/8 seconds" highlights as
// one span instead of three separate digits.
const VALUE_RE =
  /\d+(?:\/\d+)+(?:\s?(?:metres?|meters?|m|seconds?|sec|s|%))?|\d+(?:[.,]\d+)?\s?(?:metres?|meters?|m\b|seconds?|sec\b|секунд[а-я]*|метр[а-я]*|%)|\d+(?:[.,]\d+)?%/gi;

function autoHighlight(text: string): string {
  return text.replace(VALUE_RE, (match) => `**${match}**`);
}

/** Shape both Perk and LoadoutPiece share (see LoadoutPieceBase in
 *  lib/types.ts, deliberately mirroring Perk's description fields) — this
 *  module works on either without needing to know which one it's given. */
interface DescribableEntity {
  description: string;
  descriptionRu?: LocalizedDescription;
  descriptionRuRaw?: string;
}

function describe(entity: DescribableEntity, lang: Lang): PerkDescriptionView {
  if (lang === "ru" && entity.descriptionRu) {
    return {
      full: entity.descriptionRu.full,
      core: entity.descriptionRu.core,
      quote: entity.descriptionRu.quote ?? null,
      curated: true,
    };
  }

  // No hand-curated entry — auto-derive from raw text, same split/highlight
  // treatment either way. Prefer the RU wiki's own description text
  // (scripts/sync-descriptions.ts / sync-loadout-descriptions.ts) over the
  // English one when available, so RU mode isn't silently reading English
  // for slugs nobody's hand-curated yet.
  const source = lang === "ru" && entity.descriptionRuRaw ? entity.descriptionRuRaw : entity.description;
  const { body, quote } = splitQuote(source, lang);
  return {
    full: autoHighlight(body),
    core: stripLoreIntro(splitSentences(body)).map(autoHighlight),
    quote,
    curated: false,
  };
}

export function getPerkDescription(perk: DescribableEntity, lang: Lang): PerkDescriptionView {
  return describe(perk, lang);
}

/** Same derivation as getPerkDescription, just named for its actual callers
 *  (Item/Addon/Offering detail modals) — LoadoutPiece has the identical
 *  description shape, so there's nothing to duplicate here. */
export function getLoadoutPieceDescription(piece: DescribableEntity, lang: Lang): PerkDescriptionView {
  return describe(piece, lang);
}
