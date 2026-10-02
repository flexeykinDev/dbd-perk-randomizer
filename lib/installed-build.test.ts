// Resolving a build that was stored somewhere else.
//
// Every list these functions take was written by an older version of the site,
// so the interesting cases are all the same shape: something in the list no
// longer resolves, and the question is whether the caller gets a short build or
// a hole in one. A hole is the answer nobody wants, which is why each of these
// drops rather than keeps.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveLoadoutKeys,
  resolvePerkIdList,
  resolvePerkSlugs,
} from "./installed-build";
import { getPerksByRole } from "./perks";
import { getLoadoutPoolForRole } from "./loadout";
import { getIdForSlug } from "./perk-ids";

const survivors = getPerksByRole("survivor").slice(0, 4);
const killers = getPerksByRole("killer").slice(0, 4);
const pieces = getLoadoutPoolForRole("survivor", null).slice(0, 3);

const slugs = (perks: { slug: string }[]) => perks.map((p) => p.slug);
const keys = (ps: { kind: string; slug: string }[]) =>
  ps.map((p) => `${p.kind}:${p.slug}`);
const ids = (perks: { slug: string }[]) =>
  perks.map((p) => getIdForSlug(p.slug)).join(",");

test("a stored build comes back in the order it was stored", () => {
  assert.deepEqual(
    slugs(resolvePerkSlugs(slugs(survivors))),
    slugs(survivors),
  );
});

test("a perk that no longer exists is dropped, not left as a hole", () => {
  const withGhost = [survivors[0].slug, "a-perk-the-wiki-retired", survivors[1].slug];
  assert.deepEqual(slugs(resolvePerkSlugs(withGhost)), [
    survivors[0].slug,
    survivors[1].slug,
  ]);
});

test("a build whose every perk is gone resolves to nothing", () => {
  // The caller's cue to leave the board alone rather than open onto an empty
  // one.
  assert.deepEqual(resolvePerkSlugs(["gone", "also-gone"]), []);
  assert.deepEqual(resolvePerkSlugs([]), []);
});

test("asking for one side drops the other", () => {
  const mixed = [...slugs(survivors.slice(0, 2)), ...slugs(killers.slice(0, 2))];
  assert.deepEqual(
    slugs(resolvePerkSlugs(mixed, "survivor")),
    slugs(survivors.slice(0, 2)),
  );
  assert.deepEqual(
    slugs(resolvePerkSlugs(mixed, "killer")),
    slugs(killers.slice(0, 2)),
  );
});

test("asking for no side in particular keeps both", () => {
  const mixed = [...slugs(survivors.slice(0, 1)), ...slugs(killers.slice(0, 1))];
  assert.equal(resolvePerkSlugs(mixed).length, 2);
});

test("loadout keys come back as the pieces they name", () => {
  assert.deepEqual(keys(resolveLoadoutKeys(keys(pieces))), keys(pieces));
});

test("a loadout key in no format at all is dropped", () => {
  const mixed = [keys(pieces)[0], "nonsense", "addon:not-a-real-addon", ""];
  assert.deepEqual(keys(resolveLoadoutKeys(mixed)), [keys(pieces)[0]]);
});

test("chat can separate ids with commas, spaces, or both", () => {
  const expected = slugs(survivors);
  for (const text of [
    ids(survivors),
    ids(survivors).replace(/,/g, " "),
    ids(survivors).replace(/,/g, ", "),
    `  ${ids(survivors)}  `,
  ]) {
    assert.deepEqual(slugs(resolvePerkIdList(text)), expected, `failed on "${text}"`);
  }
});

test("the first id chat sends decides the side", () => {
  const mixed = `${getIdForSlug(killers[0].slug)},${getIdForSlug(survivors[0].slug)}`;
  assert.deepEqual(slugs(resolvePerkIdList(mixed)), [killers[0].slug]);
});

test("chat sending nothing usable changes nothing", () => {
  assert.deepEqual(resolvePerkIdList(""), []);
  assert.deepEqual(resolvePerkIdList("hello"), []);
  assert.deepEqual(resolvePerkIdList("999999"), []);
  assert.deepEqual(resolvePerkIdList("!paste"), []);
});

test("one bad id among good ones does not lose the build", () => {
  const text = `${getIdForSlug(survivors[0].slug)},notanumber,${getIdForSlug(survivors[1].slug)}`;
  assert.deepEqual(slugs(resolvePerkIdList(text)), [
    survivors[0].slug,
    survivors[1].slug,
  ]);
});
