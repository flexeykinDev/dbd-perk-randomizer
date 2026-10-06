// Reading BHVR's numbers out of their own patch notes.
//
// Every case here is something that actually went wrong while building this,
// which is the only reason any of them are worth a test: a parser for someone
// else's formatting is a pile of special cases, and the ones that matter are
// the ones observed rather than imagined.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  disagreements,
  fold,
  parsePatchNotes,
  stripBBCode,
  tierValues,
} from "./patch-notes";

test("tier values survive the three ways the notes write them", () => {
  assert.deepEqual(tierValues("150%/175%/200% faster"), ["150/175/200"]);
  assert.deepEqual(tierValues("Cooldown: 55 / 50 / 45s"), ["55/50/45"]);
  assert.deepEqual(tierValues("for 10/12.5/15s"), ["10/12.5/15"]);
});

test("a penalty's minus sign is not a different number", () => {
  /* Distressing: the notes say "repair 6/7/8% slower", the wiki says
   * "-6/-7/-8 % slower". Same perk, same effect. Comparing them as written
   * reported a disagreement that did not exist. */
  assert.deepEqual(tierValues("repair -6/-7/-8 % slower"), ["6/7/8"]);
  assert.deepEqual(tierValues("repair 6/7/8 % slower"), ["6/7/8"]);
});

test("a date is not a tier value", () => {
  // Undone's flavour text carries "12/02/1943", which parsed as a perk value
  // and was reported as a number the perk does not have.
  assert.deepEqual(tierValues('"Diary entry, 12/02/1943"'), []);
  // A real triple in the same string still comes through.
  assert.deepEqual(tierValues("blocked for 8/9/10s. Diary, 12/02/1943"), ["8/9/10"]);
});

test("whitespace around the slashes is matched, not the letter s", () => {
  /* The first version built this pattern from a template string, where `\s`
   * collapses to a bare "s" — so it matched the letter and worked only because
   * the common case has no spaces. This is that bug, pinned. */
  assert.deepEqual(tierValues("40 / 35 / 30 seconds"), ["40/35/30"]);
});

test("BBCode is reduced to the text under it", () => {
  const out = stripBBCode("[p]You vault [b]10%[/b] faster.[/p]&nbsp;[i](NEW)[/i]");
  assert.equal(out, "You vault 10% faster. (NEW)");
});

/** A fragment in the shape Steam actually publishes. */
const NOTES = `
[*][p][b]Premonition [/b][i](Rework)[/i][/p][list]
[*][p]Cooldown: [b]55/50/45[/b]s. [i](was 70/65/60s)[/i][/p][/*]
[/list][/*]
[*][p][b]Survivor Perks[/b][/p][list][*][p]The following perks were changed.[/p][/*][/list][/*]
[*][p][b]Resilience[/b][/p][list]
[*][p]You repair [b]7/8/9[/b]% faster. [i](was 3/6/9%)[/i][/p][/*]
[/list][/*]
`;

test("each perk's own values are read, and the old ones are not", () => {
  const perks = parsePatchNotes(NOTES);
  const byName = new Map(perks.map((p) => [p.name, p]));

  // "(was 70/65/60s)" must not count: a check that accepted it would pass
  // against data still holding the old number, which is the thing being looked
  // for in the first place.
  assert.deepEqual(byName.get("Premonition")?.values, ["55/50/45"]);
  assert.equal(byName.get("Premonition")?.rework, true);

  assert.deepEqual(byName.get("Resilience")?.values, ["7/8/9"]);
  assert.equal(byName.get("Resilience")?.rework, false);
});

test("section headings are not mistaken for perks", () => {
  // "Survivor Perks" is a heading in the same markup as a perk name. It carries
  // no values, which is what tells them apart without a list of section titles
  // that would need maintaining.
  assert.equal(
    parsePatchNotes(NOTES).some((p) => p.name === "Survivor Perks"),
    false,
  );
});

test("a perk agrees when any stated value appears in our text", () => {
  const shipped = new Map([
    ["premonition", { slug: "premonition", description: "Cool-down of 55/50/45 seconds." }],
  ]);
  assert.deepEqual(disagreements(parsePatchNotes(NOTES), shipped), []);
});

test("a perk holding the pre-release number is reported", () => {
  const shipped = new Map([
    ["premonition", { slug: "premonition", description: "Cool-down of 70/65/60 seconds." }],
  ]);
  const [problem] = disagreements(parsePatchNotes(NOTES), shipped);
  assert.equal(problem.perk, "Premonition");
  assert.equal(problem.slug, "premonition");
  assert.deepEqual(problem.expected, ["55/50/45"]);
  assert.deepEqual(problem.found, ["70/65/60"]);
});

test("a perk the notes mention but we do not ship is skipped, not reported", () => {
  // The notes cover content the data may not have yet. Whether it should be
  // here is the release gate's business, not this check's.
  assert.deepEqual(disagreements(parsePatchNotes(NOTES), new Map()), []);
});

test("Favor and Favour are the same perk", () => {
  // BHVR writes "Hex: Blood Favor" in the notes; the game and the wiki write
  // "Hex: Blood Favour". This is the only spelling difference that occurs, and
  // folding it beats a synonym list that would rot.
  assert.equal(fold("Hex: Blood Favor"), fold("Hex: Blood Favour"));
  assert.notEqual(fold("Hex: Blood Favour"), fold("Hex: Devour Hope"));
});
