// The share link, both ends.
//
// Worth testing as a pair rather than as two functions: the format's failures
// have never been "the parser is wrong", they have been the writer emitting
// something the reader throws away. A round trip catches that class in one
// assertion, so most of what is below hands the writer's output straight to
// the reader.
//
// Run against the real id map and the real perk data, like lib/perk-ids.test.ts
// does, because the link is only as good as the map it resolves through.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseShareLink,
  writeShareQuery,
  ROLE_SHORT,
  type ShareLinkState,
} from "./share-link";
import { getPerksByRole } from "./perks";
import { getLoadoutPoolForRole } from "./loadout";
import { getIdForSlug } from "./perk-ids";

const survivorPerks = getPerksByRole("survivor").slice(0, 4);
const killerPerks = getPerksByRole("killer").slice(0, 4);
const survivorLoadout = getLoadoutPoolForRole("survivor", null).slice(0, 3);

const base: ShareLinkState = {
  role: "survivor",
  mode: "perks",
  coherence: 0,
  seed: null,
  perks: [],
  loadoutPieces: [],
  squad: null,
};

const roundTrip = (state: ShareLinkState) =>
  parseShareLink(writeShareQuery(state));

const slugs = (perks: { slug: string }[] | undefined) =>
  (perks ?? []).map((p) => p.slug);

test("a rolled build survives the round trip", () => {
  const read = roundTrip({ ...base, perks: survivorPerks });
  assert.equal(read?.role, "survivor");
  assert.equal(read?.mode, "perks");
  assert.deepEqual(slugs(read?.perks), slugs(survivorPerks));
});

test("a loadout survives the round trip", () => {
  const read = roundTrip({
    ...base,
    mode: "loadout",
    loadoutPieces: survivorLoadout,
  });
  assert.equal(read?.mode, "loadout");
  assert.deepEqual(
    (read?.loadoutPieces ?? []).map((p) => `${p.kind}:${p.slug}`),
    survivorLoadout.map((p) => `${p.kind}:${p.slug}`),
  );
});

test("both mode carries both halves, which is the whole point of it", () => {
  const read = roundTrip({
    ...base,
    mode: "all",
    perks: survivorPerks,
    loadoutPieces: survivorLoadout,
  });
  assert.equal(read?.mode, "all");
  assert.deepEqual(slugs(read?.perks), slugs(survivorPerks));
  assert.equal(read?.loadoutPieces?.length, survivorLoadout.length);
});

test("a squad replaces the single build rather than sitting beside it", () => {
  const squad = [survivorPerks.slice(0, 2), survivorPerks.slice(2, 4)];
  const query = writeShareQuery({ ...base, perks: survivorPerks, squad });
  assert.ok(!query.includes("p="), `a squad link should carry no p=: ${query}`);
  const read = parseShareLink(query);
  assert.deepEqual(read?.squad?.map(slugs), squad.map(slugs));
});

test("a seed outranks the build it was rolled into", () => {
  const query = writeShareQuery({
    ...base,
    seed: "daily-2026-10-02",
    perks: survivorPerks,
  });
  assert.ok(!query.includes("p="), "a seed re-derives the build; ids are noise");
  assert.equal(parseShareLink(query)?.seed, "daily-2026-10-02");
});

test("coherence travels, and a seed does not outrank it", () => {
  // The same seed at two levels is two different builds, so the level has to
  // survive the branch that returns early for a seed.
  const read = roundTrip({ ...base, coherence: 3, seed: "shared" });
  assert.equal(read?.coherence, 3);
  assert.equal(read?.seed, "shared");
});

test("level 0 writes no c= at all, so old links stay byte-for-byte", () => {
  assert.equal(writeShareQuery({ ...base, perks: survivorPerks }).includes("c="), false);
});

test("a bare role is honoured on its own", () => {
  // The regression this format had for months: `r` is written into every link
  // the site generates, and a truncated link opened the Survivor side without
  // a word.
  const read = parseShareLink(`?r=${ROLE_SHORT.killer}`);
  assert.equal(read?.role, "killer");
  assert.equal(read?.mode, "perks");
  assert.equal(read?.perks, undefined, "nothing is marked as a shared build");
});

test("an explicit mode is enough even with no build attached", () => {
  assert.equal(parseShareLink("?r=s&mode=loadout")?.mode, "loadout");
  assert.equal(parseShareLink("?r=s&mode=all")?.mode, "all");
});

test("no role means no link to read", () => {
  assert.equal(parseShareLink(""), null);
  assert.equal(parseShareLink("?p=1,2,3"), null);
  assert.equal(parseShareLink("?r=x"), null, "an unknown short role is not a role");
});

test("the legacy full-slug format still opens", () => {
  const read = parseShareLink(
    `?role=survivor&perks=${survivorPerks.map((p) => p.slug).join(",")}`,
  );
  assert.deepEqual(slugs(read?.perks), slugs(survivorPerks));
});

test("the compact format wins when a link carries both", () => {
  const ids = survivorPerks.map((p) => getIdForSlug(p.slug)).join(",");
  const read = parseShareLink(`?r=s&p=${ids}&perks=${killerPerks[0].slug}`);
  assert.deepEqual(slugs(read?.perks), slugs(survivorPerks));
});

test("a perk from the other side is dropped, not shown mixed", () => {
  const mixed = [...survivorPerks.slice(0, 2), ...killerPerks.slice(0, 2)]
    .map((p) => getIdForSlug(p.slug))
    .join(",");
  const read = parseShareLink(`?r=s&p=${mixed}`);
  assert.deepEqual(slugs(read?.perks), slugs(survivorPerks.slice(0, 2)));
});

test("junk ids resolve to nothing rather than to an empty build", () => {
  assert.equal(parseShareLink("?r=s&p=notanumber,99999")?.perks, undefined);
});

test("a coherence level this version cannot read falls back to chaos", () => {
  for (const bad of ["9", "-1", "1.5", "synergy"]) {
    assert.equal(
      parseShareLink(`?r=s&c=${bad}`)?.coherence,
      undefined,
      `c=${bad} should leave the level alone`,
    );
  }
});

test("no c= at all means chaos, not 'unspecified'", () => {
  // Number(null) is 0 and 0 is a valid level, so a link without the parameter
  // resolves to 0 rather than to undefined. That is the right answer — a link
  // carrying no level was written at level 0 — and it is why links from before
  // the parameter existed still open the build they describe.
  assert.equal(parseShareLink("?r=s")?.coherence, 0);
  assert.equal(parseShareLink("?r=s&c=")?.coherence, 0);
});

test("role is the first parameter, because every link starts with it", () => {
  assert.ok(writeShareQuery({ ...base, role: "killer" }).startsWith("r=k"));
});
