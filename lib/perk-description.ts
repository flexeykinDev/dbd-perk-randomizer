import type { Lang } from "./i18n";
import type { LoadoutPiece } from "./types";
import type { DescribableEntity, DescriptionText, PerkDescriptionView } from "./description/types";
import {
  autoHighlight,
  isGlossaryAside,
  SECRET_BULLET,
  SECRET_OFFERING_RE,
  splitQuote,
  splitSentences,
  stripBoilerplate,
  stripLoreIntro,
} from "./description/parse";
import { overriddenCore } from "./description/overrides";

/* How a description reaches a card.
 *
 * The work is in ./description: parse.ts reads the wiki's prose, overrides.ts
 * holds the hand-written Core Effects, summary.ts condenses a view into the
 * one line the Core Effect tab shows. This file is only the composition —
 * pick the source, apply an override if there is one, hand back a view — plus
 * the public entry points, which stay here because that is where every caller
 * already imports them from. */

export type { PerkDescriptionView };
export { coreSummary } from "./description/summary";

function describe(entity: DescribableEntity, lang: Lang): PerkDescriptionView {
  const override = overriddenCore(entity, lang);
  if (override) {
    // Full text is still derived the normal way — the override is a summary,
    // not a replacement for the wiki's own words.
    const base = describeFromSource(entity, lang);
    const secret = base.core[0] === SECRET_BULLET ? [SECRET_BULLET] : [];
    return { ...base, core: [...secret, override], curated: true, coreFinal: true };
  }
  return describeFromSource(entity, lang);
}

function describeFromSource(entity: DescribableEntity, lang: Lang): PerkDescriptionView {
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
  const isSecret = SECRET_OFFERING_RE.test(source);
  const { body, quote } = splitQuote(stripBoilerplate(source), lang);
  const sentences = stripLoreIntro(splitSentences(body));
  // Guarded the same way stripLoreIntro guards its own drop: only actually
  // remove the glossary asides when something real is left behind, so a
  // hypothetical entry that somehow consists *only* of one still renders
  // something rather than an empty Core.
  const withoutGlossary = sentences.filter((s) => !isGlossaryAside(s));
  const core = (withoutGlossary.length > 0 ? withoutGlossary : sentences).map(autoHighlight);
  // Added rather than left to the sentence-level lore heuristic above (which
  // already drops the verbose original wording from Core on its own, since
  // it has no number or named term) — the disclaimer itself carries a real,
  // worth-surfacing fact that'd otherwise disappear from Core entirely.
  if (isSecret) core.unshift(SECRET_BULLET);
  return {
    full: autoHighlight(body),
    core,
    quote,
    curated: false,
  };
}

/* Both entry points ask for identity as well as text, so a caller that has
 * only the description bundle cannot compile. `kind` is the one part a perk
 * has no field for, so it is supplied here — in the single place that knows
 * the answer — rather than at each call site, where it could be forgotten
 * exactly the way it was before. */

export function getPerkDescription(
  perk: DescriptionText & { slug: string },
  lang: Lang,
): PerkDescriptionView {
  return describe({ ...perk, kind: "perk" }, lang);
}

/** Same derivation as getPerkDescription, just named for its actual callers
 *  (Item/Addon/Offering detail modals) — LoadoutPiece has the identical
 *  description shape, so there's nothing to duplicate here. */
export function getLoadoutPieceDescription(
  piece: DescriptionText & { kind: LoadoutPiece["kind"]; slug: string },
  lang: Lang,
): PerkDescriptionView {
  return describe(piece, lang);
}
