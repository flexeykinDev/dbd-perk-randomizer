// Guards the description derivation against the data underneath it
// changing shape.
//
// perk-description.ts is a pile of regexes reading prose written by wiki
// editors, and every one of them was tuned against the text Fandom happens
// to produce today. That makes it the single most fragile thing in the
// repo with respect to swapping the scraper's source over to wiki.gg —
// the mechanics won't change, but the punctuation, the boilerplate
// phrasing and the quote formatting all can, and the failure mode is
// silent: a build still renders, it just quietly shows a lore sentence as
// a mechanical bullet, or a stray quote mark, or an empty summary.
//
// So there are two kinds of test here:
//
//   * behaviour tests, each pinned to a real entry named in
//     perk-description.ts's own comments, so a regex refactor can't undo
//     a fix without saying so; and
//   * invariants run across all 1200+ shipped entries in both languages,
//     which is what would actually catch a source migration breaking the
//     parser in a way no hand-picked example covers.
//
// Run by `npm test`, which CI runs on every push.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getPerkDescription } from "./perk-description";
import type { Lang } from "./i18n";
import type { LocalizedDescription } from "./types";

const dataDir = join(dirname(fileURLToPath(import.meta.url)), "..", "data");
const load = <T>(file: string): T[] =>
  JSON.parse(readFileSync(join(dataDir, file), "utf8")) as T[];

/** The subset of Perk/LoadoutPiece this module actually reads. Uses the
 *  shipped LocalizedDescription type rather than restating its shape, so a
 *  change there fails here instead of quietly diverging. */
interface Entry {
  slug: string;
  name?: { en: string; ru: string };
  description: string;
  descriptionRu?: LocalizedDescription;
  descriptionRuRaw?: string;
}

const loadMap = <T>(file: string): Record<string, T> =>
  JSON.parse(readFileSync(join(dataDir, file), "utf8")) as Record<string, T>;

// Names and descriptions ship as separate files now (see
// scripts/split-descriptions.ts) — the list carries what a roll needs, the
// lookup carries the prose. This module is entirely about the prose, so it
// rejoins them, keyed the same way the app does at runtime.
type Prose = Omit<Entry, "slug" | "name">;
const perkProse = loadMap<Prose>("perk-descriptions.json");
const loadoutProse = loadMap<Prose>("loadout-descriptions.json");

const join2 = (
  file: string,
  prose: Record<string, Prose>,
  keyOf: (row: { slug: string }) => string,
): Entry[] =>
  load<{ slug: string; name?: { en: string; ru: string } }>(file).map((row) => {
    const text = prose[keyOf(row)];
    assert.ok(text, `${keyOf(row)} has no description entry — the split has drifted`);
    return { ...row, ...text };
  });

const perks = join2("perks.json", perkProse, (p) => p.slug);
const items = join2("items.json", loadoutProse, (p) => `item:${p.slug}`);
const addons = join2("addons.json", loadoutProse, (p) => `addon:${p.slug}`);
const offerings = join2("offerings.json", loadoutProse, (p) => `offering:${p.slug}`);
const everything = [...perks, ...items, ...addons, ...offerings];

const bySlug = (slug: string): Entry => {
  const found = everything.find((e) => e.slug === slug);
  // A renamed or dropped slug should fail loudly here rather than silently
  // skipping the case it was meant to cover.
  assert.ok(found, `fixture slug "${slug}" is no longer in the shipped data`);
  return found;
};

const LANGS: Lang[] = ["en", "ru"];

/** The contents of each `**…**` span, using the fact that splitting on the
 *  marker puts highlighted runs at odd indices and plain text at even ones.
 *  An odd total count means a marker was left unclosed. */
function highlightSpans(text: string): { spans: string[]; balanced: boolean } {
  const parts = text.split("**");
  return {
    spans: parts.filter((_, i) => i % 2 === 1),
    balanced: parts.length % 2 === 1,
  };
}

/* ------------------------------------------------------------------ */
/* Behaviour, pinned to real entries                                    */
/* ------------------------------------------------------------------ */

test("the dataset the fixtures below rely on is actually loaded", () => {
  assert.ok(perks.length > 300, `expected 300+ perks, got ${perks.length}`);
  assert.ok(addons.length > 500, `expected 500+ add-ons, got ${addons.length}`);
  assert.ok(items.length > 0);
  assert.ok(offerings.length > 0);
});

test("an attributed lore quote is split off and never left in the body", () => {
  // Picked from the data rather than named, because which perk carries an
  // attributed quote is the wiki's choice, not ours: Ace in the Hole was
  // this fixture until wiki.gg turned out to word it without a speaker.
  // The property is what matters, so the example is found, not pinned.
  const withSpeaker = perks.filter((p) => /"\s*[-—]\s*\S+/.test(p.description));
  assert.ok(withSpeaker.length > 0, "no perk carries an attributed quote any more");

  for (const perk of withSpeaker.slice(0, 25)) {
    const view = getPerkDescription(perk, "en");
    assert.ok(view.quote, `${perk.slug}: expected a quote to be extracted`);
    const speaker = view.quote!.split("—").pop()!.trim();
    assert.ok(
      !view.full.includes(speaker),
      `${perk.slug}: the speaker attribution leaked back into the full text`,
    );
  }
});

test("quotes use the typographic marks of the language being rendered", () => {
  const entry = bySlug("ace-in-the-hole");
  assert.match(getPerkDescription(entry, "en").quote!, /^“/);

  // RU only takes the « » path when it actually has RU text to render;
  // otherwise it falls back to the English source and the English marks.
  const ru = everything.find(
    (e) => e.descriptionRuRaw && /"[^"]+"\s*$/.test(e.descriptionRuRaw),
  );
  if (ru) assert.match(getPerkDescription(ru, "ru").quote!, /^«/);
});

test("the Entity boilerplate is stripped from both core and full", () => {
  const withEntity = everything.filter((e) =>
    /Calls upon The Entity for the following effect:/i.test(e.description),
  );
  assert.ok(
    withEntity.length > 0,
    "no entry carries the Entity boilerplate any more — has the source changed?",
  );
  for (const entry of withEntity) {
    const view = getPerkDescription(entry, "en");
    assert.doesNotMatch(view.full, /Calls upon The Entity/i, entry.slug);
    for (const bullet of view.core) {
      assert.doesNotMatch(bullet, /Calls upon The Entity/i, entry.slug);
    }
  }
});

test("a secret offering keeps its one real fact as the first bullet", () => {
  const secret = offerings.filter((o) =>
    /THIS OFFERING IS SECRET/i.test(o.description),
  );
  assert.ok(secret.length > 0, "no secret offerings in the data any more");
  for (const offering of secret) {
    assert.equal(getPerkDescription(offering, "en").core[0], "**Secret**.");
  }
});

test("tiered and decimal values highlight as one span, not several", () => {
  // A tiered value like "50/75/100 %" must come out as a single bold run.
  // Splitting it strands bare digits between adjacent bold spans, which is
  // what happens the moment the regex stops covering the whole construct.
  // Found in the data rather than named for the same reason as above — the
  // wiki both rewords perks and rebalances their numbers.
  // Just the numeric run — the highlighter deliberately extends the span
  // over the trailing unit too ("**20/25/30 seconds**"), so the assertion
  // is that the run sits *inside* one span, not that it is the whole span.
  const tiered = /\d+(?:\.\d+)?(?:\/\d+(?:\.\d+)?)+/;
  const withTiers = everything.filter((e) => tiered.test(e.description));
  assert.ok(withTiers.length > 20, `only ${withTiers.length} entries carry a tiered value`);

  const failures: string[] = [];
  for (const entry of withTiers) {
    const match = tiered.exec(entry.description);
    if (!match) continue;
    // A split would render "**20**/**25**/**30**", where no single span
    // contains the run — which is exactly what this catches.
    const spans = highlightSpans(getPerkDescription(entry, "en").full).spans;
    if (!spans.some((span) => span.includes(match[0]))) {
      failures.push(`${entry.slug}: ${JSON.stringify(match[0])}`);
    }
  }
  assert.deepEqual(failures.slice(0, 10), [], `${failures.length} tiered values were split`);
});

test("a lore intro is dropped from Core but kept in the full text", () => {
  // Ace in the Hole opens on "Lady Luck always seems to be throwing
  // something good your way." — flavour, no number, no named term.
  const view = getPerkDescription(bySlug("ace-in-the-hole"), "en");
  assert.match(view.full, /Lady Luck/);
  assert.ok(
    !view.core.some((b) => b.includes("Lady Luck")),
    "the flavour opener leaked into Core Effect",
  );
});

test("Core is never emptied out by the lore heuristic", () => {
  // The guard that matters: a description with no number and no named term
  // anywhere must be left alone rather than stripped to nothing.
  for (const entry of everything) {
    for (const lang of LANGS) {
      const view = getPerkDescription(entry, lang);
      if (entry.description.trim() === "") continue;
      assert.ok(
        view.core.length > 0,
        `${entry.slug} (${lang}) derived an empty Core Effect`,
      );
    }
  }
});

test("the RU quote convention (period outside, attribution after) is split off", () => {
  // `"...нож моей любви". Песня "Сквозь тебя" группы "БЕЗ ПРИКРАС"` — the
  // period sits outside the closing mark and the credit follows with no
  // dash, which none of the EN-shaped patterns can see.
  const view = getPerkDescription(bySlug("cut-thru-u-single"), "ru");
  assert.match(view.quote!, /^«Этих чувств не остановишь/);
  assert.match(view.quote!, /Песня "Сквозь тебя"/, "the credit line was dropped");
  assert.ok(
    !view.core.some((b) => b.includes("нож моей любви")),
    "the lore quote leaked into Core Effect",
  );
  assert.ok(
    !view.full.includes("Этих чувств"),
    "the lore quote is still in the body as well as the quote",
  );
});

test("a quoted term against a period is not mistaken for a lore quote", () => {
  // The counterweight to the test above. RU descriptions quote Status
  // Effect names inline, and those routinely land against a period
  // mid-paragraph — acting on that would cut the description in half.
  const view = getPerkDescription(bySlug("adrenaline"), "ru");
  assert.match(view.full, /Усталость/);
  assert.ok(
    view.full.length > 200,
    `Adrenaline's RU text was truncated to ${view.full.length} chars`,
  );
});

test("RU glossary asides stay out of Core but remain in the full text", () => {
  // The RU wiki uses straight quotes here, not guillemets — matching the
  // `[«"]` alternation RU_GLOSSARY_ASIDE_RE itself allows for.
  const withAside = perks.filter(
    (p) => p.descriptionRuRaw && /[«"]Спешка[»"]\s+ускоряет/.test(p.descriptionRuRaw),
  );
  assert.ok(
    withAside.length > 0,
    "no perk carries the Haste glossary aside any more — has the RU wiki changed?",
  );
  for (const perk of withAside) {
    const view = getPerkDescription(perk, "ru");
    if (view.curated) continue; // hand-written translations aren't derived
    assert.ok(
      !view.core.some((b) => /^«Спешка»\s+ускоряет/.test(b)),
      `${perk.slug}: the Haste glossary definition leaked into Core`,
    );
    assert.match(view.full, /«Спешка»\s+ускоряет|"Спешка"\s+ускоряет/);
  }
});

/* ------------------------------------------------------------------ */
/* Invariants across the whole shipped dataset                          */
/* ------------------------------------------------------------------ */

/** Runs `check` over every entry in both languages and reports every
 *  offender at once — a source migration tends to break a whole class of
 *  entries, and seeing one failure per run would make that take as many
 *  runs as there are broken entries. */
function forEveryEntry(
  what: string,
  check: (view: ReturnType<typeof getPerkDescription>, entry: Entry, lang: Lang) => string | null,
) {
  test(what, () => {
    const failures: string[] = [];
    for (const entry of everything) {
      for (const lang of LANGS) {
        const problem = check(getPerkDescription(entry, lang), entry, lang);
        if (problem) failures.push(`${entry.slug} (${lang}): ${problem}`);
      }
    }
    assert.deepEqual(
      failures.slice(0, 20),
      [],
      `${failures.length} entries failed`,
    );
  });
}

forEveryEntry("no bullet is empty or pure punctuation", (view) => {
  const junk = view.core.find((b) => !/[\p{L}\p{N}]/u.test(b));
  return junk === undefined ? null : `bullet ${JSON.stringify(junk)} has no content`;
});

const quoteCount = (text: string) => (text.match(/"/g) ?? []).length;

// The one entry whose quote genuinely can't be split correctly, and which
// perk-description.ts documents as such: Dead Hard's lore quotes a second
// speaker *inside* itself, so the closing mark the patterns find is the
// nested one. Separating those needs a real parser rather than a regex,
// which isn't worth it for one perk. Listed by slug rather than skipped so
// that a fix, or a second entry developing the same problem, both show up.
const KNOWN_NESTED_QUOTE = new Set(["dead-hard"]);

test("the known nested-quote case is still exactly one entry", () => {
  for (const slug of KNOWN_NESTED_QUOTE) bySlug(slug);
});

forEveryEntry("the split never leaves a stray quote mark behind", (view, entry, lang) => {
  if (KNOWN_NESTED_QUOTE.has(entry.slug)) return null;
  // A lone `"` in the rendered text means the quote splitter cut in the
  // wrong place — the failure mode that produced `"` as its own sentence
  // on Queen's Sceptre.
  //
  // Only checked against sources that were balanced to begin with. A dozen
  // wiki cells ship genuinely mismatched quotes (Valtiel Sect Photograph's
  // RU text opens `Подписана "Багровый и Белый банкет для богов.` and never
  // closes it), and faithfully passing that through is correct behaviour —
  // rewriting the wiki's punctuation is not this module's job. What would
  // be a real defect is *introducing* an imbalance, so that's what this
  // asserts.
  const source = lang === "ru" && entry.descriptionRuRaw ? entry.descriptionRuRaw : entry.description;
  if (view.curated || quoteCount(source) % 2 === 1) return null;
  const stray = [view.full, ...view.core].find((text) => quoteCount(text) % 2 === 1);
  return stray === undefined ? null : `unbalanced quote mark in ${JSON.stringify(stray)}`;
});


forEveryEntry("highlight markers are balanced", (view) => {
  const bad = [view.full, ...view.core].find((text) => !highlightSpans(text).balanced);
  return bad === undefined ? null : `odd number of ** in ${JSON.stringify(bad)}`;
});

forEveryEntry("no highlight span is empty", (view) => {
  // Checked on span contents rather than by pattern-matching `** **`, which
  // also matches the gap between two *adjacent* spans — and adjacent spans
  // are the normal case here ("**50 %** **Haste Status Effect**").
  const bad = [view.full, ...view.core].find((text) =>
    highlightSpans(text).spans.some((s) => s.trim() === ""),
  );
  return bad === undefined ? null : `empty highlight span in ${JSON.stringify(bad)}`;
});

forEveryEntry("every derived bullet comes from the full text", (view) => {
  // Core is a filtered view of Full, never new prose — the one deliberate
  // exception being the "Secret." fact prepended for secret offerings.
  if (view.curated) return null;
  const plain = (s: string) => s.replace(/\*\*/g, "");
  const full = plain(view.full);
  const invented = view.core
    .filter((b) => b !== "**Secret**.")
    .find((b) => !full.includes(plain(b)));
  return invented === undefined ? null : `bullet not present in full text: ${JSON.stringify(invented)}`;
});

forEveryEntry("the lore quote is never also left in the body", (view) => {
  if (!view.quote || view.curated) return null;
  // Compare on the inner text: the quote is re-wrapped in typographic
  // marks, so the raw string won't match either way.
  const inner = view.quote.replace(/^[“«]|[”»].*$/g, "").trim();
  if (inner.length < 12) return null; // too short to match meaningfully
  return view.full.includes(inner) ? `quote duplicated in full text` : null;
});
