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

    // Two shapes of credit follow the closing mark, and the RU wiki uses
    // both. Either the sentence's period sits outside the quote and the
    // credit runs on after it:
    //
    //   "…нож моей любви". Песня "Сквозь тебя"
    //
    // or the speaker is parenthesised, which is how Ghost Face's add-ons
    // are written and which left a stray `"` on three of them:
    //
    //   "…незабываемые подарки" (Гоуст Фейс).
    const rest = text.slice(close + 1);
    const parenthesised = /^\s*\((.+?)\)\.?\s*$/.exec(rest);
    if (rest[0] !== "." && !parenthesised) continue;

    const inner = text.slice(open + 1, close);
    if (inner.length < LORE_QUOTE_MIN_LENGTH) continue;
    if (inner.trim().split(/\s+/).length < LORE_QUOTE_MIN_WORDS) continue;

    const attribution = (parenthesised ? parenthesised[1] : rest.slice(1)).trim();
    if (attribution === "" || attribution.length > ATTRIBUTION_MAX_LENGTH) continue;
    if (attribution.includes("%")) continue;
    return {
      body: text.slice(0, open).trim(),
      inner,
      // A dash is optional in the run-on form; drop it when present so the
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
  /\d+(?:[.,]\d+)?(?:\/\d+(?:[.,]\d+)?)+(?:\s?(?:metres?|meters?|m|seconds?|sec|s|%))?|\d+(?:[.,]\d+)?\s?(?:metres?|meters?|m\b|seconds?|sec\b|секунд[а-я]*|сек\.?|метр[а-я]*|мин\.?|м\b|%)|\d+(?:[.,]\d+)?%/gi;

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

/* The RU wiki writes add-on text as run-on clauses with no full stop between
 * them — "…увеличивается на 50% Дальность растёт… максимум Эффект
 * сбрасывается, когда…" arrives as ONE sentence, so splitSentences above has
 * nothing to split on and the Core Effect tab printed a 355-character wall
 * where it promised a summary. Measured across the 1382 add-on core bullets:
 * 558 ran past 80 characters and 175 past 120.
 *
 * This finds the seam the punctuation does not mark: a clause ending — a
 * value, a closing quote, a colon, or just a lowercase word — followed by a
 * capital that starts a new statement. `*` is in the set because highlighting
 * has already wrapped values as `**50%**` by this point, so the character
 * before the gap is an asterisk rather than the percent sign.
 *
 * A comma is deliberately NOT a boundary: "Пока собака бежит…, Егерь
 * получает…" is one thought, and splitting there would cut an effect in half
 * rather than shorten it.
 *
 * The lookahead deliberately does NOT allow an opening quote before the
 * capital. Named terms are quoted inline — «Кары обреченных», "Дикого
 * бешенства" — so permitting one split "Сокращает дальность «Кары
 * обреченных» на 50%" into a useless "Сокращает дальность", deleting the
 * effect it was supposed to summarise. 152 of 912 summaries came out under
 * 25 characters that way. */
const RU_RUN_ON_RE = /(?<=[%»"*:;\p{Ll}\d])\s+(?=\p{Lu}\p{Ll})/gu;

/** Below this, a "clause" is a fragment like "При" or "Если" rather than a
 *  summary of anything. */
const MIN_CLAUSE = 40;

/* RU_RUN_ON_RE exists because the Russian wiki runs clauses together with no
 * punctuation between them. English has the opposite habit: it punctuates
 * properly and Title-Cases every game term, so the same rule fires between
 * "Increased" and "Altruistic Healing", and between "Great" and "Skill
 * Check" — turning correct sentences into fragments. "Can be used to heal
 * other Survivors: Increased" was a real summary on the live site.
 *
 * So the splitter is chosen by script, not applied to both. English is split
 * on actual sentence ends, which is all it needs. */
const CYRILLIC_RE = /\p{Script=Cyrillic}/u;
const EN_SENTENCE_RE = /(?<=[.!?])\s+(?=\p{Lu})/gu;

/* A highlighted number is the strongest available signal that a bullet
 * states the effect rather than describing the object. autoHighlight only
 * wraps a value once it carries a unit or a percent, so "32 Charges" in a
 * flavour sentence stays bare while "+50 %" does not — which is exactly the
 * difference between the Festive Toolbox's lore and its actual repair
 * bonus. A bare `\d` test cannot tell those apart, and picked the lore. */
const HIGHLIGHTED_VALUE_RE = /\*\*[^*]*\d[^*]*\*\*/;

/** A lead-in, not an answer: "Modifies the Fog Vial with the following
 *  effect:" and "Данный предмет обладает рядом особенностей:" are both
 *  complete clauses over MIN_CLAUSE that say nothing at all. */
const LEAD_IN_RE = /[:—-]\s*$/;

/* A wiki habit that turns a summary into a paragraph: having named a status,
 * the RU text goes on to explain it — "…ещё на 2% «Замедление» снижает
 * скорость передвижения…". That definition is part of the same sentence
 * grammatically, and RU_RUN_ON_RE cannot split it off, because the clause
 * begins with a quote rather than a capital and the lookahead deliberately
 * excludes quotes.
 *
 * So it is found directly: a quoted term followed by a word that is not a
 * preposition. That exclusion list is the whole safety margin — "«Кары
 * обреченных» НА 50%" is an add-on's own mechanic and starts identically,
 * and the earlier attempt at trimming quotes cut 152 summaries down to their
 * first three words. */
/* `\b` is deliberately absent. JavaScript defines a word boundary against
 * [A-Za-z0-9_] even under the `u` flag, so "для\b" can never match after a
 * Cyrillic letter — the boundary simply is not there. Written with `\b` this
 * whole exclusion list was inert, the tail matched on the FIRST quoted term
 * instead of the definition, and the summary lost its own effect. A
 * negative lookahead for another letter is the boundary this needs. */
const RU_DEFINITION_TAIL_RE =
  /\s+\*{0,2}[«"“][^«»"“”]{2,40}[»"”]\*{0,2}\s+(?!(?:на|в|во|до|от|за|и|или|с|со|к|по|при|для|над|под|через|после|перед|из|о|об)(?!\p{L}))\p{Ll}{3,}/u;

/** The first complete clause of a description, for the Core Effect tab.
 *
 *  Everything dropped here is still one tab away under Full Text, which is
 *  what makes trimming safe: the summary's job is to answer "what does this
 *  do" at a glance, not to be complete. */
export function coreSummary(view: PerkDescriptionView, maxChars = 150): string | null {
  const filled = view.core.filter((b) => b.trim().length > 0 && !LEAD_IN_RE.test(b.trim()));
  /* The first bullet that says what the thing DOES, not simply the first.
   *
   * Some add-ons open with flavour and put the mechanic in the next bullet —
   * "Челюсть с длинными зубами, которые вгрызаются в плоть…" is a sentence
   * about teeth and tells a player nothing they can act on. stripLoreIntro
   * already handles this within a bullet; this is the same rule one level up.
   * Falls back to the first bullet when nothing looks mechanical, rather than
   * guessing — a few add-ons genuinely are described only in prose. */
  const first = filled.find((b) => HIGHLIGHTED_VALUE_RE.test(b)) ?? filled.find(isMechanical) ?? filled[0];
  if (!first) return null;
  // Cut the trailing status definition before anything else looks at this,
  // so it can never be the thing that pushes the summary over budget.
  const tail = first.search(RU_DEFINITION_TAIL_RE);
  const bullet = tail > MIN_CLAUSE ? first.slice(0, tail).trim() : first;
  /* No attempt to strip a trailing flavour quote. One was tried and cut real
   * effects in half: the RU text mixes «», "" and "" for named terms, so a
   * "quote to end of string" match opened on a term like «Кары обреченных»
   * and never found its partner, leaving "Сокращает дальность" — the effect
   * deleted and the flavour it was meant to remove not even present. Flavour
   * sits at the END of a description, and this only ever takes the FIRST
   * clause, so it is nearly always out of range anyway. */
  /* Not simply the first piece. Plenty of sentences carry a capitalised word
   * that is not a new statement — "При Ударе…", "Если Выживший…" — and taking
   * the split at face value produced summaries reading "При" and "Если". So
   * pieces are rejoined until there is enough of a sentence to be worth
   * showing, and only then does the next boundary end it. */
  const split = bullet.split(CYRILLIC_RE.test(bullet) ? RU_RUN_ON_RE : EN_SENTENCE_RE);
  /* Flavour and effect are sometimes fused into one bullet with no
   * punctuation between them — "Такое ощущение, что она сама отмеряет
   * идеальное расстояние Увеличивает количество зарядов карты на 2" is a
   * single string on the wiki. stripLoreIntro applies this rule across
   * bullets; the same rule is needed inside one. Only when something later
   * is mechanical, so prose-only descriptions are left alone rather than
   * emptied. */
  const firstReal = split.findIndex(isMechanical);
  const parts = firstReal > 0 ? split.slice(firstReal) : split;
  let clause = "";
  for (const part of parts) {
    const next = clause ? `${clause} ${part}` : part;
    // A clause that ends in a colon has introduced the effect without
    // stating it. Keep going even though it is long enough to stop on.
    if (LEAD_IN_RE.test(next.trim())) {
      clause = next;
      continue;
    }
    /* Stop BEFORE a clause that would overrun rather than taking it and
     * cutting it in half. A summary ending "…получают эффект «Замедление» и
     * двигаются…" tells a reader less than stopping a clause earlier would,
     * because it looks like the answer and is not one. Unless nothing has
     * been kept yet — half an answer still beats none. */
    if (clause && next.trim().length > maxChars) break;
    clause = next;
    if (clause.trim().length >= MIN_CLAUSE) break;
  }
  clause = clause.trim();
  if (clause.length <= maxChars) return clause || bullet.slice(0, maxChars);
  /* Over budget, but often only because of a preamble. The EN wiki front-
   * loads a condition before the colon — "While repairing a Generator with a
   * Toolbox, you benefit from the following effect: …" — which is the same
   * sentence, so nothing above can split it, and it swallowed the budget
   * before the effect began. 100 of the 979 English summaries were truncated
   * that way, against 16 in Russian.
   *
   * Dropped only when the text would otherwise be cut, and only when what
   * follows is itself mechanical: on anything that already fits, the
   * condition is worth keeping, since "heals faster" and "heals faster while
   * injured" are different claims. */
  const colon = clause.indexOf(": ");
  if (colon > 0) {
    const rest = clause.slice(colon + 2).trim();
    if (rest.length >= MIN_CLAUSE && rest.length <= maxChars && isMechanical(rest)) return rest;
  }

  /* Genuinely one long clause — there is no seam to stop at, so cut at a
   * word boundary and mark it. This is what the ellipsis is actually for.
   * Never leave a `**` span half-open; an unterminated marker renders as
   * literal asterisks. */
  let cut = clause.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(" ");
  if (lastSpace > maxChars * 0.6) cut = cut.slice(0, lastSpace);
  if ((cut.match(/\*\*/g) ?? []).length % 2 === 1) cut = cut.slice(0, cut.lastIndexOf("**"));
  return `${cut.trim()}…`;
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
