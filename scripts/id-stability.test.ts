// Two halves: the guard's own logic, and the shipped maps it guards.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { idProblems, type IdMap } from "./id-stability";

const dataDir = join(dirname(fileURLToPath(import.meta.url)), "..", "data");
const load = <T>(file: string): T => JSON.parse(readFileSync(join(dataDir, file), "utf8")) as T;

/* ------------------------------------------------------------------ */
/* The guard                                                           */
/* ------------------------------------------------------------------ */

test("an unchanged map is silent, and so is one that only gained keys", () => {
  const before: IdMap = { "iron-will": 1, adrenaline: 2 };
  assert.deepEqual(idProblems(before, before), []);
  assert.deepEqual(idProblems(before, { ...before, "new-perk": 3 }), []);
});

test("a reassigned id is reported first, because it is already breaking links", () => {
  const before: IdMap = { "iron-will": 1, adrenaline: 2, lithe: 3 };
  const after: IdMap = { "iron-will": 2, adrenaline: 1, lithe: 3 };
  const problems = idProblems(before, after);
  assert.deepEqual(
    problems.map((p) => `${p.kind}:${p.key}`),
    ["reassigned:iron-will", "reassigned:adrenaline"],
  );
});

test("dropping a key counts, because its number can be handed out again later", () => {
  // The damage is delayed rather than absent: the next run sees a free
  // number and gives it to something else, and every link holding it now
  // resolves to the wrong perk.
  const problems = idProblems({ "retired-perk": 7, lithe: 8 }, { lithe: 8 });
  assert.deepEqual(
    problems.map((p) => p.kind),
    ["dropped"],
  );
  assert.match(problems[0].detail, /reused/);
});

test("two keys sharing one id is caught even when nothing was reassigned", () => {
  // A freshly rebuilt map can be internally wrong without differing from
  // the old one on any single key.
  const problems = idProblems({}, { lithe: 4, sprint_burst: 4 });
  assert.deepEqual(
    problems.map((p) => `${p.kind}:${p.key}`),
    ["duplicate:sprint_burst"],
  );
});

/* ------------------------------------------------------------------ */
/* The shipped maps                                                     */
/* ------------------------------------------------------------------ */

test("every shipped perk and loadout piece has a share id", () => {
  // Anything without one is silently dropped from every link it belongs
  // in — the build someone receives is simply shorter than the one sent.
  const perkIds = load<IdMap>("perk-ids.json");
  const missingPerks = load<{ slug: string }[]>("perks.json")
    .filter((p) => perkIds[p.slug] === undefined)
    .map((p) => p.slug);
  assert.deepEqual(missingPerks.slice(0, 5), [], `${missingPerks.length} perks have no id`);

  const loadoutIds = load<IdMap>("loadout-ids.json");
  const keys = [
    ...load<{ slug: string }[]>("items.json").map((p) => `item:${p.slug}`),
    ...load<{ slug: string }[]>("addons.json").map((p) => `addon:${p.slug}`),
    ...load<{ slug: string }[]>("offerings.json").map((p) => `offering:${p.slug}`),
  ];
  const missingPieces = keys.filter((k) => loadoutIds[k] === undefined);
  assert.deepEqual(missingPieces.slice(0, 5), [], `${missingPieces.length} pieces have no id`);
});

test("no id is shared by two things", () => {
  for (const file of ["perk-ids.json", "loadout-ids.json"]) {
    const byId = new Map<number, string[]>();
    for (const [key, id] of Object.entries(load<IdMap>(file))) {
      byId.set(id, [...(byId.get(id) ?? []), key]);
    }
    const clashes = [...byId.entries()].filter(([, keys]) => keys.length > 1);
    assert.deepEqual(clashes.slice(0, 3), [], `${file}: ${clashes.length} ids used twice`);
  }
});

test("retired slugs keep their ids rather than being tidied away", () => {
  // The map is deliberately larger than the shipped data: a perk that has
  // been renamed or removed keeps its number so links holding it can still
  // be resolved through data/perk-slug-aliases.json. A map that exactly
  // matched the current perks would mean old numbers had been freed.
  const perkIds = load<IdMap>("perk-ids.json");
  const shipped = load<{ slug: string }[]>("perks.json").length;
  assert.ok(
    Object.keys(perkIds).length >= shipped,
    `perk-ids.json has ${Object.keys(perkIds).length} entries for ${shipped} shipped perks — ids appear to have been dropped`,
  );
});
