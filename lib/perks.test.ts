// The data layer every other module reads through.
//
// CLAUDE.md names lib/perks.ts as the only place UI code should touch the
// generated JSON from, and it had no test file. The reason that matters is
// not coverage for its own sake: a slug is a PROMISE. It lives in share
// links people have posted, in saved pools, in favourites and in history,
// and none of those expire. A rename that stops resolving breaks all of them
// at once, silently, and the only symptom is a perk quietly missing from
// somebody's pool.
//
// Run against the real shipped data rather than fixtures, the way
// scripts/assets.test.ts does — the question here is whether this code reads
// what the project actually ships, not whether a fixture round-trips.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getAvailablePool,
  getPerkBySlug,
  getPerksByRole,
  getTeachablePerks,
  isNewPerk,
  perks,
  perksMeta,
} from "./perks";
import { getTagsForPerk, getTagsForRole, classifyPerk } from "./perk-tags";
import aliasData from "../data/perk-slug-aliases.json";
import descriptionData from "../data/perk-descriptions.json";

const aliases = (aliasData as { aliases: Record<string, string> }).aliases;

test("every alias resolves to a perk that still exists", () => {
  /* The whole point of the alias map. An entry pointing at a slug the wiki
   * has since renamed AGAIN would leave a dead link that looks alive. */
  for (const [retired, current] of Object.entries(aliases)) {
    const perk = getPerkBySlug(retired);
    assert.ok(perk, `${retired} no longer resolves — every link naming it is broken`);
    assert.equal(perk.slug, current, `${retired} should follow to ${current}`);
  }
});

test("a slug that never existed returns undefined rather than throwing", () => {
  // A hand-edited share link, or a pool saved by a much older build.
  for (const bad of ["", "not-a-perk", "../etc/passwd", "ADRENALINE", "null"]) {
    assert.equal(getPerkBySlug(bad), undefined, `${bad} should be a miss, not a throw`);
  }
});

test("no alias shadows a live perk", () => {
  /* If the game ever reused a retired name, the alias would hijack the real
   * perk and the lookup would hand back the wrong one — which renders
   * perfectly and is wrong. */
  const live = new Set(perks.map((p) => p.slug));
  for (const retired of Object.keys(aliases)) {
    assert.ok(!live.has(retired), `${retired} is both an alias and a live slug`);
  }
});

test("the role counts are the ones the site prints", () => {
  // These two numbers are rendered in the subtitle, so a wrong one is
  // visible on every page load.
  assert.equal(getPerksByRole("survivor").length, perksMeta.survivorCount);
  assert.equal(getPerksByRole("killer").length, perksMeta.killerCount);
  assert.equal(perksMeta.survivorCount + perksMeta.killerCount, perks.length);
});

test("a role's pool contains only that role", () => {
  for (const role of ["survivor", "killer"] as const) {
    assert.ok(getPerksByRole(role).every((p) => p.role === role));
  }
});

test("excluding perks removes exactly those and nothing else", () => {
  const pool = getPerksByRole("survivor");
  const excluded = new Set(pool.slice(0, 5).map((p) => p.slug));
  const left = getAvailablePool("survivor", excluded);
  assert.equal(left.length, pool.length - 5);
  assert.ok(left.every((p) => !excluded.has(p.slug)));
  // An empty set is the common case and must not copy or filter needlessly.
  assert.equal(getAvailablePool("survivor", new Set()).length, pool.length);
});

test("teachables belong to the character asked for", () => {
  const survivor = getPerksByRole("survivor")[0].character;
  const teachables = getTeachablePerks("survivor", survivor);
  assert.ok(teachables.length > 0, "a character with no teachables is a data problem");
  assert.ok(teachables.every((p) => p.character === survivor && p.role === "survivor"));
});

test("isNewPerk reads the window, not the calendar", () => {
  /* It drives the NEW badge. A perk with a malformed date must not come back
   * as new — an Invalid Date comparison is false, which is the safe answer,
   * and this pins it so a refactor cannot flip it. */
  assert.equal(isNewPerk({ ...perks[0], addedAt: "not a date" }), false);
  assert.equal(isNewPerk({ ...perks[0], addedAt: new Date().toISOString() }), true);
  assert.equal(isNewPerk({ ...perks[0], addedAt: "2020-01-01T00:00:00.000Z" }), false);
});

// --- tags -----------------------------------------------------------------

test("a perk with no tags reads as matching nothing, not as an error", () => {
  // Perks scraped before tags were stored have no `tags` key at all.
  const { tags: _omitted, ...withoutTags } = perks[0];
  assert.deepEqual(getTagsForPerk(withoutTags as typeof perks[0]), []);
});

test("every tag a perk carries is one its role actually offers", () => {
  /* A tag that no filter chip lists is invisible: the perk carries it, the
   * pool manager never shows it, and the only symptom is a filter that
   * returns fewer perks than it should. */
  for (const role of ["survivor", "killer"] as const) {
    const offered = new Set(getTagsForRole(role).map((t) => t.id));
    for (const perk of getPerksByRole(role)) {
      for (const tag of getTagsForPerk(perk)) {
        assert.ok(offered.has(tag), `${perk.slug} carries ${tag}, which ${role} does not offer`);
      }
    }
  }
});

test("the classifier still produces the tags the shipped data carries", () => {
  /* classifyPerk runs in the scraper, and its output is baked into
   * perks.json. Nothing re-runs it at render time, so a broken regex would
   * not show up until the next scrape silently dropped a tag from the pool
   * filter — weeks later, with no error. This re-derives a sample and
   * compares. */
  /* The text lives in data/perk-descriptions.json, not perks.json — the
   * split is deliberate and documented in CLAUDE.md, because the prose was
   * the bulk of the first-paint payload. So the classifier's input has to be
   * reassembled from both files, exactly as the scraper has it. */
  const descriptions = descriptionData as Record<string, { description?: string }>;
  const sample = perks.filter((p) => descriptions[p.slug]?.description).slice(0, 40);
  assert.ok(sample.length > 0, "needs perks carrying description text to classify");
  for (const perk of sample) {
    const derived = classifyPerk({
      name: perk.name,
      description: descriptions[perk.slug].description as string,
      role: perk.role,
    });
    assert.deepEqual(
      [...derived].sort(),
      [...getTagsForPerk(perk)].sort(),
      `${perk.slug}: the classifier and the shipped tags disagree`,
    );
  }
});
