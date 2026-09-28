// Plural forms, checked against the rule they replaced.
//
// `ruPlural` was a hand-written Russian rule living in the module every
// component imports — correct for Russian, wrong for anything else, and the
// thing a third language would have had to either duplicate or ignore. It is
// now Intl.PluralRules, which is the same CLDR data every browser ships.
//
// Swapping a rule that decides visible text is only safe if the new one
// agrees with the old one everywhere it is used, so that is what most of
// this file does — including with the exact form objects the real call sites
// pass, not idealised ones.
import { test } from "node:test";
import assert from "node:assert/strict";
import { plural } from "./i18n";

/** The rule that used to live in lib/i18n.tsx, verbatim. */
function ruPlural(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

/* The form objects the migrated call sites actually pass. Written out here
 * rather than imported, because the point is to catch someone changing one
 * of them without meaning to. Note each uses `other` where the old code
 * passed `many`: for Russian those categories differ only on fractions, and
 * every count on this site is a whole number of perks, players or minutes.
 * The tests below are what makes that claim checkable rather than assumed. */
const REAL_CALL_SITES: { where: string; forms: Parameters<typeof plural>[2] }[] = [
  { where: "daily-count: сыграл", forms: { one: "сыграл", other: "сыграли" } },
  { where: "daily-count: игрок", forms: { one: "игрок", few: "игрока", other: "игроков" } },
  { where: "daily-streak: день", forms: { one: "день", few: "дня", other: "дней" } },
  { where: "history: минута", forms: { one: "минуту", few: "минуты", other: "минут" } },
  { where: "history: час", forms: { one: "час", few: "часа", other: "часов" } },
  { where: "share-card: перк", forms: { one: "перк", few: "перка", other: "перков" } },
  { where: "share-card: игрок", forms: { one: "игрок", few: "игрока", other: "игроков" } },
];

test("every migrated call site produces exactly what the old rule produced", () => {
  for (const { where, forms } of REAL_CALL_SITES) {
    const one = forms.one ?? forms.other;
    const few = forms.few ?? forms.other;
    const many = forms.other;
    for (let n = 0; n <= 2000; n++) {
      assert.equal(
        plural("ru", n, forms),
        ruPlural(n, one, few, many),
        `${where} disagreed at ${n}`,
      );
    }
  }
});

test("the Russian categories land where Russian speakers expect", () => {
  const forms = { one: "перк", few: "перка", other: "перков" };
  // The cases the hand-written rule existed to get right.
  assert.equal(plural("ru", 1, forms), "перк");
  assert.equal(plural("ru", 2, forms), "перка");
  assert.equal(plural("ru", 4, forms), "перка");
  assert.equal(plural("ru", 5, forms), "перков");
  assert.equal(plural("ru", 0, forms), "перков");
  // The teens, which are the trap: 11 is not "one", 12-14 are not "few".
  assert.equal(plural("ru", 11, forms), "перков");
  assert.equal(plural("ru", 12, forms), "перков");
  assert.equal(plural("ru", 14, forms), "перков");
  assert.equal(plural("ru", 21, forms), "перк");
  assert.equal(plural("ru", 22, forms), "перка");
  assert.equal(plural("ru", 111, forms), "перков");
  assert.equal(plural("ru", 121, forms), "перк");
});

test("English needs only the two forms it has", () => {
  const forms = { one: "player", other: "players" };
  assert.equal(plural("en", 1, forms), "player");
  assert.equal(plural("en", 0, forms), "players");
  assert.equal(plural("en", 2, forms), "players");
  assert.equal(plural("en", 21, forms), "players", "English has no teens trap");
});

test("a language that needs no forms at all still gets a word", () => {
  // Japanese has a single category. A contributor writing one string must
  // not have to know that.
  assert.equal(plural("ja", 1, { other: "パーク" }), "パーク");
  assert.equal(plural("ja", 5, { other: "パーク" }), "パーク");
});

test("a form a language asks for but the caller did not supply falls back", () => {
  /* This is load-bearing: `many` is deliberately absent from every call site
   * above, and Russian asks for it on 5, 0 and the teens. Falling through to
   * `other` is what makes those read correctly, and is why `other` is the
   * one required key. A missing form can never render blank. */
  const forms = { one: "день", other: "дней" };
  assert.equal(plural("ru", 5, forms), "дней", "the many category fell back");
  assert.equal(plural("ru", 3, forms), "дней", "so did few");
  assert.equal(plural("ru", 1, forms), "день");
});

test("nonsense input gets a word rather than an exception", () => {
  const forms = { one: "перк", other: "перков" };
  // Intl throws on a malformed tag and on a non-finite number; neither is
  // worth a blank screen or a crashed render.
  assert.equal(plural("ru", Number.NaN, forms), "перков");
  assert.equal(plural("ru", Number.POSITIVE_INFINITY, forms), "перков");
  assert.equal(plural("not-a-language-tag!", 1, forms), "перков");
  assert.equal(plural("", 1, forms), "перков");
});

test("fractions are answered, even though nothing here counts in halves", () => {
  // Russian's `other` category is reached only by non-integers. Nothing on
  // this site produces one today; this is here so that if something ever
  // does, the behaviour is known rather than discovered.
  assert.equal(plural("ru", 1.5, { one: "перк", few: "перка", other: "перков" }), "перков");
  assert.equal(plural("en", 1.5, { one: "perk", other: "perks" }), "perks");
});
