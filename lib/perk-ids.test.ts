// The squad share format, and the promise it has to keep: the single-build
// `?p=` format is untouched, and a squad link survives a round trip through a
// URL exactly as it was rolled — same perks, same players, same order.
//
// Run against the real id map rather than a fixture. The ids are the thing
// being tested: a link is only as good as the map it resolves through, and
// scripts/id-stability.ts already guards that the map never reassigns one.
import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeSquadParam, encodeSquadParam, getIdForSlug } from "./perk-ids";
import { getPerksByRole } from "./perks";
import { rollSquad, type Squad } from "./squad-roll";
import { createSeededRandom } from "./seeded-random";

const slugsOf = (squad: Squad) => squad.map((build) => build.map((p) => p.slug));

test("a rolled squad survives the round trip, player by player", () => {
  const pool = getPerksByRole("survivor");
  for (let i = 0; i < 50; i++) {
    const squad = slugsOf(rollSquad(pool, 4, 4, createSeededRandom(`link-${i}`)));
    const param = encodeSquadParam(squad);
    assert.ok(param, "every shipped perk has an id, so this should encode");
    assert.deepEqual(decodeSquadParam(param), squad, `seed link-${i} did not round-trip`);
  }
});

test("the encoded form is the ids, dot-separated between players", () => {
  const first = getPerksByRole("survivor").slice(0, 4).map((p) => p.slug);
  const second = getPerksByRole("survivor").slice(4, 8).map((p) => p.slug);
  const expected = [
    first.map((s) => getIdForSlug(s)).join(","),
    second.map((s) => getIdForSlug(s)).join(","),
  ].join(".");
  assert.equal(encodeSquadParam([first, second]), expected);
});

test("the dot survives URL encoding, so the link stays readable", () => {
  const param = encodeSquadParam([["adrenaline"], ["resilience"]]);
  assert.ok(param);
  const query = new URLSearchParams({ sq: param }).toString();
  assert.ok(query.includes("."), `a dot should not be percent-encoded: ${query}`);
  // And it comes back out of a real URL unchanged.
  const parsed = new URLSearchParams(query).get("sq");
  assert.equal(parsed, param);
  assert.deepEqual(decodeSquadParam(parsed as string), [["adrenaline"], ["resilience"]]);
});

test("a perk with no id refuses to encode rather than dropping a player's perk", () => {
  assert.equal(encodeSquadParam([["adrenaline"], ["not-a-real-perk-slug"]]), null);
  assert.equal(encodeSquadParam([]), null);
});

test("uneven builds keep their shape", () => {
  const squad = [["adrenaline", "resilience"], ["sprint-burst"], ["lithe", "dead-hard", "kindred"]];
  const param = encodeSquadParam(squad);
  assert.ok(param);
  assert.deepEqual(decodeSquadParam(param), squad);
});

test("a damaged link opens with what is left instead of nothing", () => {
  const good = getIdForSlug("adrenaline");
  const also = getIdForSlug("resilience");
  assert.ok(good !== undefined && also !== undefined);

  // An id that no longer maps to anything is dropped from its build.
  assert.deepEqual(decodeSquadParam(`${good},99999999`), [["adrenaline"]]);
  // Junk where a number should be, same treatment.
  assert.deepEqual(decodeSquadParam(`${good},abc`), [["adrenaline"]]);
  // A trailing dot, a doubled one, and a build that resolves to nothing do
  // not add blank players to someone else's squad.
  assert.deepEqual(decodeSquadParam(`${good}.${also}.`), [["adrenaline"], ["resilience"]]);
  assert.deepEqual(decodeSquadParam(`${good}..${also}`), [["adrenaline"], ["resilience"]]);
  assert.deepEqual(decodeSquadParam(`${good}.99999999.${also}`), [
    ["adrenaline"],
    ["resilience"],
  ]);
  assert.deepEqual(decodeSquadParam(""), []);
  assert.deepEqual(decodeSquadParam("....."), []);
});

test("the single-build format is not a squad and vice versa", () => {
  // `?p=` has no dots, so reading it as a squad yields exactly one build —
  // which is what makes it safe for the board to try `sq` first and fall
  // through to `p` when it is absent, without the two ever colliding.
  const ids = ["adrenaline", "resilience"].map((s) => getIdForSlug(s)).join(",");
  assert.deepEqual(decodeSquadParam(ids), [["adrenaline", "resilience"]]);
});
