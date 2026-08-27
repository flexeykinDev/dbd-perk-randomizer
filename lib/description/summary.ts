import type { PerkDescriptionView } from "./types";
import { isMechanical, SECRET_BULLET } from "./parse";

/* Condensing a description into the one line the Core Effect tab shows.
 *
 * This is the half that has to make a judgement rather than a match: which
 * bullet actually states the effect, where a clause can be cut without
 * lying, and how much of the rest will fit. */

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

/* How the wiki OPENS an effect, as opposed to describing the object.
 *
 * isMechanical asks whether a sentence mentions anything mechanical
 * anywhere, which flavour text does constantly: "repair instructions on this
 * piece of bark" contains a named term, so the bark scored the same as
 * "Suppresses all regular Repair Skill Checks" and, being first, won. Where
 * a bullet has no highlight to rank on, the reliable difference is
 * structural — an effect leads with its verb or its condition, and flavour
 * leads with the noun it is describing.
 *
 * "Если" is the one conditional left out. RU flavour opens with it happily
 * — "Если зажечь рядом с картой…" is the Sharpened Flint's lore — whereas
 * "При" is how most RU effects begin ("При починке с помощью инструментов
 * проверки реакции не появляются"), and excluding it on the same suspicion
 * left almost every Russian add-on still showing its flavour. */
const EFFECT_OPENER_RE =
  /^(?:Increases|Reduces|Grants|Causes|Extends|Modifies|Unlocks|Suppresses|Disables|Switches|Prevents|Allows|Applies|Removes|Adds|Nullifies|Kills|While|When|After|Whenever|Press|Hold|Each time|You can no longer|You are no longer|При|Когда|После|Нажмите|Удерживайте|Каждый|Вы больше не|Вы не можете|Установленные|Нельзя|Успешн|Увеличивает|Уменьшает|Снижает|Повышает|Сокращает|Расширяет|Открывает|Позволяет|Да[её]т|Дарует|Отмен[яе]|Убирает|Скрывает|Продлевает|Ускоряет|Замедляет|Заменяет|Применяет|Накладывает)/;

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
/* Editorial connective tissue, in the Core Effect only.
 *
 * The wiki introduces an effect rather than stating it: "While repairing a
 * Generator with a Toolbox, you benefit from the following effect:
 * Suppresses all regular Repair Skill Checks." The condition is worth
 * keeping — it says WHEN — but "you benefit from the following effect" is
 * eleven words that carry none of it, and on a summary capped at 150
 * characters they are eleven words that push the actual effect out.
 *
 * Collapsed to a colon rather than deleted, so the sentence still reads as
 * condition-then-effect. Full Text keeps the wiki's own phrasing. */
const CONNECTIVE_RE =
  /,?\s*(?:you (?:benefit from|gain) the following effects?|(?:which )?grants? the following effects?|with the following effects?|triggers? the following effects?)\s*:?/gi;

function tighten(text: string): string {
  return text
    .replace(CONNECTIVE_RE, ":")
    .replace(/\s*:\s*:/g, ":")
    .replace(/\s+:/g, ":")
    .replace(/:\s*$/, "")
    .trim();
}


/** Appends the piece's remaining effects to a summary that has room. */
function joinFurtherEffects(
  summary: string,
  bullets: string[],
  used: string,
  maxChars: number,
): string {
  let out = summary;
  /* Every other bullet, in document order — not just the ones after the
   * ranked pick. The Unique Wedding Ring's -100 % ranks highest and sits
   * LAST, so joining forward from it reached nothing and the two Aura
   * effects above it stayed invisible. */
  for (const bullet of bullets) {
    if (bullet === used) continue;
    const next = tighten(bullet).trim();
    if (!next || !statesAnEffect(next)) continue;
    // Already said, in the clause taken from the first bullet.
    if (out.includes(next)) continue;
    if (out.length + 1 + next.length > maxChars) break;
    out = `${out.replace(/[.\s]*$/, ".")} ${next}`;
  }
  return out;
}

/** A bullet that plainly states an effect: it carries a value, a highlighted
 *  term, or opens the way the wiki opens an effect. Used to decide what may
 *  be appended to a summary, so a downside cannot be quietly dropped. */
function statesAnEffect(text: string): boolean {
  const t = text.trim();
  return HIGHLIGHTED_VALUE_RE.test(t) || t.includes("**") || EFFECT_OPENER_RE.test(t);
}

/* Add-ons that do two things were only ever showing one of them.
 *
 * The Unique Wedding Ring reveals the Obsession's Aura to you, reveals yours
 * to them, AND removes your chance of being the Obsession — four bullets on
 * the wiki, of which a pick-one summary showed exactly one. Worse, the one
 * it showed was whichever ranked highest, so a downside like "You can no
 * longer vault Pallets" or "Placed Traps can only be reset" simply vanished:
 * the summary read as pure upside for an add-on that has a cost.
 *
 * So the effects are joined rather than chosen between, up to the budget.
 * Only bullets that plainly state an effect are appended — the wiki's own
 * asides ("can be combined with any other Mix Tape Add-on") are not effects
 * and were never the thing anyone opened the card to read. */
const MAX_JOINED = 200;

export function coreSummary(view: PerkDescriptionView, maxChars = MAX_JOINED): string | null {
  if (view.coreFinal) {
    // Past the Secret marker, which is a badge rather than the effect.
    const written = view.core.find((b) => b !== SECRET_BULLET);
    if (written) return written;
  }
  const filled = view.core.filter((b) => b.trim().length > 0 && !LEAD_IN_RE.test(b.trim()));
  /* The first bullet that says what the thing DOES, not simply the first.
   *
   * Some add-ons open with flavour and put the mechanic in the next bullet —
   * "Челюсть с длинными зубами, которые вгрызаются в плоть…" is a sentence
   * about teeth and tells a player nothing they can act on. stripLoreIntro
   * already handles this within a bullet; this is the same rule one level up.
   * Falls back to the first bullet when nothing looks mechanical, rather than
   * guessing — a few add-ons genuinely are described only in prose. */
  /* Ranked, strongest signal first.
   *
   * A highlighted NUMBER is the surest sign a bullet states the effect.
   * Failing that, any highlight at all: autoHighlight wraps the wiki's named
   * terms, and the wiki capitalises them only when it means the game
   * mechanic — "Suppresses all regular **Repair Skill Checks**" gets marked
   * where the flavour sentence's lowercase "repair instructions on this
   * piece of bark" does not. isMechanical cannot tell those apart, because
   * it matches the bare word, and so it picked the bark. */
  const first =
    filled.find((b) => HIGHLIGHTED_VALUE_RE.test(b)) ??
    filled.find((b) => b.includes("**")) ??
    filled.find((b) => EFFECT_OPENER_RE.test(b.trim())) ??
    filled.find(isMechanical) ??
    filled[0];
  if (!first) return null;
  // Cut the trailing status definition before anything else looks at this,
  // so it can never be the thing that pushes the summary over budget.
  const tidy = tighten(first);
  const tail = tidy.search(RU_DEFINITION_TAIL_RE);
  const bullet = tail > MIN_CLAUSE ? tidy.slice(0, tail).trim() : tidy;
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
  /* Long enough to actually be flavour. The splitter breaks before any
   * capitalised term, so a perfectly ordinary opening — "Плотность Тёмного
   * тумана" — arrives as a one-word part that fails isMechanical, and
   * dropping it silently deleted the subject of the sentence. Lore is a
   * clause, not a word. */
  const droppedIsLore =
    firstReal > 0 && split.slice(0, firstReal).join(" ").trim().length >= MIN_CLAUSE;
  const parts = droppedIsLore ? split.slice(firstReal) : split;
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
  if (clause.length <= maxChars) {
    return joinFurtherEffects(clause || bullet.slice(0, maxChars), filled, first, maxChars);
  }
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
