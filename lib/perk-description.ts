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

// Scraped descriptions end with `"quote text" — Speaker Name` (perks,
// character-voiced) or just a bare `"quote text"` with no attribution at
// all (items/add-ons/offerings — flavor text, not a character line) —
// either way glued directly onto the mechanical text with no other
// separator. Try the attributed form first since it's more specific; a
// bare quote is only assumed once that fails, so an attributed quote can
// never be mis-split as if it had no speaker.
//
// Two variants of each, tried in order: `[^"]+` (excludes quote marks
// from the captured span) is the default, since it correctly stops at the
// *nearest* closing quote — which matters whenever a description has more
// than one separate quoted span (e.g. Boyfriend's Memo's RU text opens
// with a quoted nickname AND ends with a quoted lore line — a greedy
// match would swallow the real mechanical sentence sitting between them).
// `.+` (greedy) is a fallback for the rarer opposite problem: a character
// quote that nests a second quoted phrase *inside* itself (dialogue
// quoting dialogue). Doesn't fully solve it — Dead Hard nests one
// ("...I thought to myself "Gonna 'ave some fun 'ere lads..." — David
// King") deep enough that the non-greedy pattern above still finds a
// (wrong) match starting at the nested mark before the fallback ever gets
// a chance to run — but it's a net improvement for every other nested
// case that doesn't also collide with the non-greedy pattern's own
// left-to-right search order, and Dead Hard's result here is no worse
// than before this file's quote-handling was touched at all. Properly
// disambiguating nesting depth would need actual quote-aware parsing,
// not a regex — not worth it for what's currently a single known perk.
const ATTRIBUTED_QUOTE_RE = /"([^"]+)"\s*[-—]\s*(.+)\s*$/;
const ATTRIBUTED_QUOTE_NESTED_RE = /"(.+)"\s*[-—]\s*(.+)\s*$/;
const BARE_QUOTE_RE = /"([^"]+)"\s*$/;
const BARE_QUOTE_NESTED_RE = /"(.+)"\s*$/;

// The RU wiki writes a lore quote to a different convention than the EN
// one, and none of the four patterns above can see it: the sentence's
// period sits *outside* the closing mark, and the attribution follows the
// quote with no dash at all.
//
//   EN:  "We were walkin' through t'ginnel..." — David King
//   RU:  "...нож моей любви". Песня "Сквозь тебя" группы "БЕЗ ПРИКРАС"
//
// The attributed patterns want `"` directly against the dash, so the
// period defeats them; the bare patterns want `"` at the very end, so the
// attribution defeats those. The result was that these descriptions kept
// their whole lore quote in the body, and the sentence splitter then
// served it up as Core Effect bullets — the exact "no lore in Core" case
// Core Effect exists to avoid.
//
// Rather than another end-anchored regex, this pairs the quote marks
// left-to-right and looks for a pair whose closing mark is followed by a
// period — which is what the RU convention actually produces, and what
// distinguishes the lore quote from the several other quoted spans these
// entries carry (band names, Status Effect names, song titles). The last
// such pair wins, since attribution trails the lore rather than preceding
// it.
//
// The guards matter more than the search here, because `".` on its own is
// far too common in RU text to act on: the RU wiki quotes Status Effect
// names inline and they routinely land against a period mid-paragraph
// (Adrenaline: `...навыки, которые вызывают "Усталость".`). Acting on that
// would cut a description in half. So a candidate only counts when it
// looks like a lore quote rather than a quoted term:
//
//   * the quoted span is a sentence, not a name — long, and several words;
//   * something follows the period, i.e. there is an attribution at all;
//   * that attribution is short and carries no percentage, so a mechanical
//     sentence following a quoted term can't be mistaken for a credit.
//
// Together these also keep it off the EN flavor sentence that merely ends
// on a quoted phrase (`A battery marked as "industrial strength".`), which
// is body text rather than a lore quote.
const LORE_QUOTE_MIN_LENGTH = 25;
const LORE_QUOTE_MIN_WORDS = 4;
const ATTRIBUTION_MAX_LENGTH = 120;

function splitTrailingAttributedQuote(
  text: string,
): { body: string; inner: string; attribution: string } | null {
  const marks: number[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '"') marks.push(i);
  }
  if (marks.length < 2) return null;

  for (let pair = Math.floor(marks.length / 2) * 2 - 2; pair >= 0; pair -= 2) {
    const open = marks[pair];
    const close = marks[pair + 1];
    if (text[close + 1] !== ".") continue;
    const inner = text.slice(open + 1, close);
    if (inner.length < LORE_QUOTE_MIN_LENGTH) continue;
    if (inner.trim().split(/\s+/).length < LORE_QUOTE_MIN_WORDS) continue;
    const attribution = text.slice(close + 2).trim();
    if (attribution === "" || attribution.length > ATTRIBUTION_MAX_LENGTH) continue;
    if (attribution.includes("%")) continue;
    return {
      body: text.slice(0, open).trim(),
      inner,
      // A dash is optional in this form; drop it when present so the
      // rendered attribution doesn't end up with two.
      attribution: attribution.replace(/^[-—]\s*/, ""),
    };
  }
  return null;
}

function splitQuote(text: string, lang: Lang): { body: string; quote: string | null } {
  const attributed = text.match(ATTRIBUTED_QUOTE_RE) ?? text.match(ATTRIBUTED_QUOTE_NESTED_RE);
  if (attributed && attributed.index !== undefined) {
    const body = text.slice(0, attributed.index).trim();
    const quoted = lang === "ru" ? `«${attributed[1]}»` : `“${attributed[1]}”`;
    return { body, quote: `${quoted} — ${attributed[2].trim()}` };
  }
  // Ahead of the bare patterns, not after them. Those anchor on the very
  // end of the string, and the RU credit line usually *ends* on a quoted
  // name — a band, a song, a scripture reference — so given first refusal
  // they walk off with that name as "the quote" and leave the actual lore
  // sitting in the body (Cut Thru U Single ends `группы "БЕЗ ПРИКРАС"`,
  // and that is what came out as its quote). This pattern is much more
  // heavily guarded than they are, so letting it go first costs nothing
  // where it doesn't apply.
  const trailing = splitTrailingAttributedQuote(text);
  if (trailing) {
    const quoted = lang === "ru" ? `«${trailing.inner}»` : `“${trailing.inner}”`;
    return { body: trailing.body, quote: `${quoted} — ${trailing.attribution}` };
  }
  const bare = text.match(BARE_QUOTE_RE) ?? text.match(BARE_QUOTE_NESTED_RE);
  if (bare && bare.index !== undefined) {
    const body = text.slice(0, bare.index).trim();
    const quoted = lang === "ru" ? `«${bare[1]}»` : `“${bare[1]}”`;
    return { body, quote: quoted };
  }
  return { body: text.trim(), quote: null };
}

// Pure wiki-editor connective tissue with zero mechanical content of its
// own — same idea as UPCOMING_PATCH_NOTICE in scripts/scrape-perks.ts.
// Colon-glued onto the sentence that follows rather than period-glued, so
// sentence-splitting alone can't separate it out; stripped as an exact
// known phrase (not inferred) since guessing at "is this lore" for
// arbitrary text is exactly what produces false positives.
const CALLS_UPON_ENTITY_RE = /Calls upon The Entity for the following effect:\s*/gi;

// The "secret offering" disclaimer (Memento Moris, Shroud of Union, ...)
// is templated verbatim wherever it appears — a real, worth-surfacing
// mechanical fact (a secret offering doesn't reveal itself to other
// players before the Trial loads), just buried in far more wiki-editor
// wording than Core Effect's "1-2 short sentences" goal allows. Detected
// separately so its short "Secret." fact can be prepended to Core Effect
// explicitly — the sentence-level lore heuristic below already drops the
// verbose original from Core on its own (no number, no named term), this
// only adds back the one bit of it actually worth keeping.
const SECRET_OFFERING_RE =
  /THIS OFFERING IS SECRET \(This Offering is secret and will not reveal its identity to the other Players during the burning sequence before loading into the Trial\.\)\s*/i;

function stripBoilerplate(text: string): string {
  return text.replace(CALLS_UPON_ENTITY_RE, "").trim();
}

// `\s*` (not `\s+`): a handful of scraped descriptions are missing the
// space after a sentence-ending period entirely (confirmed by hand, e.g.
// Disfigured Ear: "...deaf boy's ear.Deformed due to..."), which left the
// lore half permanently glued to whatever mechanical sentence followed it
// no matter how good the lore-detection heuristic below got — nothing to
// detect if it's never split into its own sentence to begin with. Safe to
// allow a zero-width boundary here: a decimal point is never immediately
// followed by a capital letter (it's followed by another digit), so this
// can't misfire on a value like "4.73".
//
// `"?` in the lookbehind (found by hand auditing the newest wiki.gg-sourced
// perks, e.g. Do No Harm: `"Helping...get." When healing...`): a bare,
// unattributed flavor quote with no space before its closing mark sits
// directly against the period it shares with the *next* sentence — without
// this, the closing `"` would otherwise be readable as the *next*
// sentence's opening quote and get glued onto the wrong side, leaking a
// stray `"` onto the front of the kept sentence. Bundling an optional
// trailing quote into the lookbehind keeps it attached to the sentence it
// actually closes instead.
//
// The lookahead is now two branches instead of one shared `\s*` — a plain
// letter can still follow with zero spaces (the Disfigured Ear typo case
// above), but a quote character may only start a new sentence when at
// least one real space precedes it (`\s+`, not `\s*`). Without that split,
// the closing-quote case above produces *two* boundaries a single
// character apart — one right before the closing quote (lookahead sees the
// quote itself and treats it as a fresh quoted sentence starting) and one
// right after it (lookbehind's own `"?` branch) — leaving the lone quote
// mark stranded as its own empty "sentence" between two real ones (found
// on Queen's Sceptre: `"...demands blood." Successfully hitting...` came
// out as three pieces, not two, with `"` alone in the middle). Requiring a
// real space before a quote can open a new sentence means a quote sitting
// directly against the preceding period is only ever read as that
// sentence's own closing mark, never as a second, competing boundary.
function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!)]"?)(?:\s*(?=[A-ZА-ЯЁ])|\s+(?=["«„“]))/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

// Named DBD Status Effects and core game states carry real mechanical
// meaning even with no accompanying number — "suffer from the Deep Wound
// Status Effect" or "once they are in the Dying State" are as
// game-mechanical as any percentage. Extracted from what the scraped
// text actually contains (every recurring "<Name> Status Effect"/"<Name>
// State" phrase across perks/items/add-ons/offerings), not guessed from
// general DBD knowledge, so both the lore-detection heuristic below and
// the highlighter it feeds can recognize them reliably. EN-only for
// now — the RU wiki text uses its own separate vocabulary this doesn't
// attempt to cover.
const NAMED_TERM_SOURCE =
  '\\b[A-Z][a-zA-Z]+(?:\\s+[A-Z][a-zA-Z]+)?\\s+Status Effect\\b|\\b(?:Dying|Injured|Healthy) State\\b';
// Two instances of the same pattern, not one shared regex: a global
// regex's `lastIndex` persists across calls, so reusing one object for
// both `.test()` (isMechanical, called repeatedly in a loop over many
// sentences) and `.replace()` (autoHighlight) would silently skip matches
// on whichever call didn't happen to start at index 0.
const NAMED_TERM_TEST_RE = new RegExp(NAMED_TERM_SOURCE);
const NAMED_TERM_REPLACE_RE = new RegExp(NAMED_TERM_SOURCE, "g");

// Sentence-initial effect verbs — every wiki cell that opens with one of
// these is describing a mechanical effect, even on the rare sentence that
// spells a small number out as a word instead of a numeral ("spawn
// together in pairs in two different locations" has no digit for the
// number-based check below to catch). Extracted from what the scraped
// text's sentence-initial words actually are (the ~10 most frequent,
// unambiguous ones), not guessed — deliberately excludes anything
// ambiguous enough to open a flavor sentence too (e.g. a bare "Survivors"
// or "This").
const MECHANICAL_VERB_RE =
  /^(?:Increases|Reduces|Grants|Causes|Extends|Modifies|Unlocks|Suppresses|Disables|Switches)\b/;

// Purely wiki-editorial connective tissue introducing an effect list — same
// spirit as CALLS_UPON_ENTITY_RE below, just recognized here instead of
// stripped outright, since (unlike that phrase) this one carries the
// sentence it's embedded in rather than gluing onto the front of one.
// Never appears in flavor text (confirmed by hand across all 1200+ scraped
// entries) — it exists specifically to introduce mechanical text — so it's
// a safe signal even for an effect sentence that happens to have no number,
// %, or named term of its own (found on Queen's Sceptre: "Successfully
// hitting a Survivor ... triggers the following effect: Causes a Leeching
// Gland to spatter..." has none of those, so without this the sentence
// couldn't be confirmed mechanical, and stripLoreIntro's own safety net —
// "only drop the lore intro if something after it still looks
// mechanical" — left the flavor sentence in Core right alongside it rather
// than risk dropping real content).
const TRIGGERS_EFFECT_RE = /triggers? (?:its|the following) (?:primary |secondary )?effects?/i;

// A sentence that mentions a number, a percentage, a named Status
// Effect/state, or opens with a known effect verb reads as actual
// game-mechanic text; one that doesn't is very likely flavor — several
// item/add-on wiki cells open with a flavor sentence glued directly onto
// the mechanical text with no separator other than the period (confirmed
// by hand, e.g. Filthy Slippers: "Max sometimes struggled to hear his
// mother's footfalls. Gain the Undetectable Status Effect...").
// Deliberately does NOT treat a bare quote mark as a mechanical hint the
// way an earlier version did — that caught genuine named-term references
// but just as often a flavor sentence quoting itself for emphasis (e.g.
// Heavy Duty Battery: `A battery marked as "industrial strength".`),
// misclassifying it as mechanical and leaking it into Core.
function isMechanical(sentence: string): boolean {
  return (
    /\d|%/.test(sentence) ||
    NAMED_TERM_TEST_RE.test(sentence) ||
    MECHANICAL_VERB_RE.test(sentence) ||
    TRIGGERS_EFFECT_RE.test(sentence)
  );
}

// The RU wiki appends generic glossary definitions of the Status Effects a
// perk references — "Haste speeds up the movement of Killers and
// Survivors", "Exposed Survivors take lethal damage from Basic Attacks
// even at full health", and so on. They explain what a status effect *is*
// rather than what this perk does, which is exactly the glossary noise a
// one-glance Core Effect summary should leave out (the Full Text tab still
// carries them — see the contract note below).
//
// These survive isMechanical above by design: they name a status effect
// and describe its behaviour, so no general heuristic can separate them
// from a real effect sentence. Matched instead as known sentence openings,
// the same exact-phrase approach CALLS_UPON_ENTITY_RE takes for the
// equivalent EN boilerplate. Every entry below was derived from the real
// dataset rather than guessed — by finding which Core sentences repeat
// verbatim across many unrelated perks (a sentence appearing identically
// on 13 different perks is boilerplate by definition), then keeping only
// the ones that are genuinely definitions. Deliberately excludes other
// frequently-repeated-but-real lines that scan turned up, e.g.
// "Перезарядка: 60 сек" (a real cooldown) and the Scourge Hook setup
// sentence, both of which are this perk's own mechanics.
//
// Dropped from Core only, never from Full Text — same contract as
// stripLoreIntro below: the detail view still shows the wiki's text
// verbatim, so nothing is lost, it just stays out of the summary.
const RU_GLOSSARY_ASIDE_RE = new RegExp(
  "^(?:" +
    [
      '[«"]Спешка[»"]\\s+ускоряет', // Haste
      "Уязвимые выжившие получают", // Exposed
      "Усталые выжившие не могут", // Exhausted
      "Ослабленных выживших нельзя", // Broken
      "Незаметные убийцы", // Undetectable
      "Забывчивые выжившие не слышат", // Oblivious
      "Стойких выживших нельзя", // Endurance
      "Замедленные убийцы и выжившие", // Hindered
      "Ослепшие убийцы и выжившие", // Blindness
      "Кровоточащие выжившие", // Haemorrhage
    ].join("|") +
    ")",
);

function isGlossaryAside(sentence: string): boolean {
  return RU_GLOSSARY_ASIDE_RE.test(sentence.trim());
}

/** Drops a leading run of non-mechanical (flavor) sentences from the Core
 *  Effect bullets — the Full Text tab still shows everything verbatim, so
 *  nothing is actually lost, just kept out of the short summary. Only
 *  commits to dropping when something *after* the dropped prefix still
 *  looks mechanical; a description that never mentions a number/named
 *  term at all is left untouched rather than guessed at. */
function stripLoreIntro(sentences: string[]): string[] {
  if (sentences.length < 2) return sentences;
  let dropCount = 0;
  while (dropCount < sentences.length - 1 && !isMechanical(sentences[dropCount])) {
    dropCount++;
  }
  if (dropCount === 0) return sentences;
  const remainder = sentences.slice(dropCount);
  return remainder.some(isMechanical) ? remainder : sentences;
}

// Tiered values (6/7/8) before bare numbers so "6/7/8 seconds" highlights as
// one span instead of three separate digits. Each tier can itself carry a
// decimal (found by hand on the newest wiki.gg-sourced perks, e.g. "Come
// and Get Me!"'s "10/12.5/15 seconds") — without `(?:[.,]\d+)?` on every
// tier, the ".5" stops the tiered match early and starts a second one,
// leaving a stray unhighlighted "." stranded between two separate bold
// spans instead of one clean "10/12.5/15 seconds".
const VALUE_RE =
  /\d+(?:[.,]\d+)?(?:\/\d+(?:[.,]\d+)?)+(?:\s?(?:metres?|meters?|m|seconds?|sec|s|%))?|\d+(?:[.,]\d+)?\s?(?:metres?|meters?|m\b|seconds?|sec\b|секунд[а-я]*|метр[а-я]*|%)|\d+(?:[.,]\d+)?%/gi;

function autoHighlight(text: string): string {
  return text
    .replace(VALUE_RE, (match) => `**${match}**`)
    .replace(NAMED_TERM_REPLACE_RE, (match) => `**${match}**`);
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
  if (isSecret) core.unshift("**Secret**.");
  return {
    full: autoHighlight(body),
    core,
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
