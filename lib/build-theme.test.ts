import { test } from "node:test";
import assert from "node:assert/strict";
import { getBuildTheme } from "./build-theme";
import { getPerksByRole } from "./perks";
import { getTagsForPerk } from "./perk-tags";
import { pickCoherentPerks } from "./coherence";
import { createSeededRandom } from "./seeded-random";
import type { Perk } from "./types";

const survivor = getPerksByRole("survivor");
const withTag = (id: string) => survivor.filter((p) => getTagsForPerk(p).includes(id));

test("a build where most perks share a tag reports it", () => {
  const aura = withTag("aura").slice(0, 3);
  const other = survivor.find((p) => !getTagsForPerk(p).includes("aura"))!;
  const theme = getBuildTheme([...aura, other], "survivor");
  assert.ok(theme, "three of four sharing a tag is a theme");
  assert.equal(theme.tag.id, "aura");
  assert.equal(theme.count, 3);
  assert.equal(theme.total, 4);
});

test("a tag on exactly half the build is not a theme", () => {
  /* The line has to be the thing you would have noticed yourself. Two of
   * four is a coincidence the tags produce constantly — survivor perks
   * average 1.52 tags each, so several will collide in any four. */
  const aura = withTag("aura").slice(0, 2);
  const untagged = survivor.filter((p) => getTagsForPerk(p).length === 0).slice(0, 2);
  assert.equal(getBuildTheme([...aura, ...untagged], "survivor"), null);
});

test("a build of untagged perks says nothing rather than reaching", () => {
  const untagged = survivor.filter((p) => getTagsForPerk(p).length === 0).slice(0, 4);
  assert.ok(untagged.length >= 3, "the fixture needs untagged perks to exist");
  assert.equal(getBuildTheme(untagged, "survivor"), null);
});

test("fewer than three perks can never have a theme", () => {
  const aura = withTag("aura").slice(0, 2);
  assert.equal(getBuildTheme(aura, "survivor"), null);
  assert.equal(getBuildTheme(aura.slice(0, 1), "survivor"), null);
});

test("the same build always reports the same theme", () => {
  const build = [...withTag("aura").slice(0, 3), withTag("healing")[0]];
  const first = getBuildTheme(build, "survivor");
  for (let i = 0; i < 20; i++) {
    assert.deepEqual(getBuildTheme(build, "survivor"), first);
  }
});

/* The line has to agree with the dial, which is the one claim here that
 * could be false without anyone noticing: a threshold tuned by eye could
 * easily fire as often at chaos as at full synergy, and then the dial and
 * the line would be telling different stories about the same build. */
function themeRate(level: 0 | 1 | 2 | 3, runs = 400): number {
  let hits = 0;
  for (let i = 0; i < runs; i++) {
    const random = createSeededRandom(`theme-${level}-${i}`);
    const build = pickCoherentPerks(survivor, 4, level, random) as Perk[];
    if (getBuildTheme(build, "survivor")) hits++;
  }
  return hits / runs;
}

test("the line is rare at chaos and common at full synergy", () => {
  const chaos = themeRate(0);
  const full = themeRate(3);
  console.log(`  theme rate — chaos ${(chaos * 100).toFixed(1)}%, synergy ${(full * 100).toFixed(1)}%`);
  assert.ok(chaos < 0.35, `chaos should rarely have a theme, got ${(chaos * 100).toFixed(1)}%`);
  assert.ok(full > chaos + 0.25, `the dial should move the rate, ${chaos.toFixed(2)} -> ${full.toFixed(2)}`);
});
