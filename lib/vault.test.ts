// The vault, and in particular the thing standing between a file on disk and
// the player's saved builds.
//
// An import is the only place in this app where a file someone else wrote
// reaches stored state. It may have been edited by hand, truncated by a bad
// download, written by a version that does not exist yet, or not be ours at
// all — and none of those may throw, wipe what is already saved, or put a
// row in the list that does nothing when pressed.
//
// Run against the real perk data, because "unknown slug" only means anything
// relative to the pool that actually ships.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  deleteBuild,
  exportVault,
  getVault,
  importVaultFile,
  parseVaultFile,
  renameBuild,
  saveBuild,
  type VaultBuild,
} from "./vault";

const STORAGE_KEY = "dbd-randomizer:vault";

/** Slugs that really exist in data/perks.json. */
const REAL = ["adrenaline", "ace-in-the-hole", "a-place-for-us"];

const file = (builds: unknown[], extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    app: "dbd-perk-randomizer",
    kind: "vault",
    version: 1,
    exportedAt: 1,
    builds,
    ...extra,
  });

const perkBuild = (name: string, keys: string[] = REAL) => ({
  id: "whatever",
  name,
  role: "survivor",
  mode: "perks",
  keys,
  savedAt: 1700000000000,
});

beforeEach(() => {
  localStorage.clear();
});

// --- the validator --------------------------------------------------------

test("a good file imports whole", () => {
  const result = parseVaultFile(file([perkBuild("My build")]));
  assert.equal(result.problem, null);
  assert.equal(result.builds.length, 1);
  assert.equal(result.builds[0].name, "My build");
  assert.deepEqual(result.builds[0].keys, REAL);
  assert.equal(result.droppedBuilds, 0);
  assert.equal(result.droppedKeys, 0);
});

test("a truncated file is reported, not thrown", () => {
  const good = file([perkBuild("My build")]);
  for (const cut of [good.length - 1, Math.floor(good.length / 2), 5, 1]) {
    const result = parseVaultFile(good.slice(0, cut));
    assert.equal(result.problem, "not-json", `cut at ${cut}`);
    assert.deepEqual(result.builds, [], "nothing half-read gets through");
  }
});

test("unknown perk slugs are dropped, and the build survives without them", () => {
  const result = parseVaultFile(
    file([perkBuild("Mixed", ["adrenaline", "not-a-perk", "ace-in-the-hole", ""])]),
  );
  assert.equal(result.problem, null);
  assert.deepEqual(result.builds[0].keys, ["adrenaline", "ace-in-the-hole"]);
  assert.equal(result.droppedKeys, 2, "the unknown one and the empty one");
  assert.equal(result.droppedBuilds, 0);
});

test("a build whose perks have all gone is dropped rather than left unopenable", () => {
  const result = parseVaultFile(file([perkBuild("Ghost", ["gone", "also-gone"])]));
  assert.equal(result.problem, "empty", "nothing usable was in the file");
  assert.equal(result.droppedBuilds, 1);
  assert.equal(result.droppedKeys, 2);
  assert.deepEqual(result.builds, []);
});

test("a file from a future version imports what this version understands", () => {
  const result = parseVaultFile(
    file(
      [
        {
          ...perkBuild("From the future"),
          // Fields this build has never heard of.
          colour: "#ff0000",
          tags: ["meta", "anti-tunnel"],
          nested: { deeply: { pointless: true } },
        },
      ],
      { version: 99, somethingNew: { added: "later" } },
    ),
  );
  assert.equal(result.problem, null, "a newer file is not a broken file");
  assert.equal(result.builds.length, 1);
  assert.equal(result.builds[0].name, "From the future");
  assert.deepEqual(result.builds[0].keys, REAL);
});

test("total garbage is refused with a reason", () => {
  for (const [text, problem] of [
    ["", "not-json"],
    ["not json at all", "not-json"],
    ["<html><body>404</body></html>", "not-json"],
    ["null", "not-a-vault"],
    ["[]", "not-a-vault"],
    ['"a string"', "not-a-vault"],
    ["42", "not-a-vault"],
    ["{}", "not-a-vault"],
    ['{"app":"something-else","builds":[]}', "not-a-vault"],
    ['{"app":"dbd-perk-randomizer","builds":"nope"}', "not-a-vault"],
  ] as [string, string][]) {
    const result = parseVaultFile(text);
    assert.equal(result.problem, problem, JSON.stringify(text).slice(0, 40));
    assert.deepEqual(result.builds, []);
  }
});

test("entries of the wrong shape are dropped, the rest of the file still lands", () => {
  const result = parseVaultFile(
    file([
      perkBuild("Keeper"),
      null,
      "a string",
      42,
      [],
      { name: "no role", mode: "perks", keys: REAL },
      { name: "no mode", role: "survivor", keys: REAL },
      { name: "bad role", role: "clown", mode: "perks", keys: REAL },
      { name: "bad mode", role: "survivor", mode: "interpretive-dance", keys: REAL },
      { name: "keys not an array", role: "survivor", mode: "perks", keys: "adrenaline" },
    ]),
  );
  assert.equal(result.problem, null);
  assert.equal(result.builds.length, 1, "one good entry among nine bad ones");
  assert.equal(result.builds[0].name, "Keeper");
  assert.equal(result.droppedBuilds, 9);
});

test("a nameless build gets a name rather than an empty row", () => {
  const result = parseVaultFile(
    file([
      { ...perkBuild("x"), name: "" },
      { ...perkBuild("y"), name: "   " },
      { ...perkBuild("z"), name: 42 },
    ]),
  );
  assert.equal(result.builds.length, 3);
  for (const build of result.builds) {
    assert.ok(build.name.trim().length > 0, `"${build.name}" should not be blank`);
  }
});

test("an enormous name is cut down to a label", () => {
  const result = parseVaultFile(file([{ ...perkBuild("x"), name: "A".repeat(100_000) }]));
  assert.ok(result.builds[0].name.length <= 60);
});

test("a repeated perk inside one build is kept once", () => {
  const result = parseVaultFile(
    file([perkBuild("Doubled", ["adrenaline", "adrenaline", "ace-in-the-hole"])]),
  );
  assert.deepEqual(result.builds[0].keys, ["adrenaline", "ace-in-the-hole"]);
});

test("loadout builds resolve through their kind:slug keys", () => {
  const result = parseVaultFile(
    file([
      {
        name: "Flashlight run",
        role: "survivor",
        mode: "loadout",
        keys: ["item:flashlight", "offering:hollow-shell", "item:not-a-thing", "malformed"],
        savedAt: 1,
      },
    ]),
  );
  assert.equal(result.problem, null);
  assert.deepEqual(result.builds[0].keys, ["item:flashlight", "offering:hollow-shell"]);
  assert.equal(result.droppedKeys, 2);
});

test("imported ids are replaced, so a file cannot collide with what is saved", () => {
  const a = parseVaultFile(file([perkBuild("One"), perkBuild("Two")]));
  assert.notEqual(a.builds[0].id, "whatever");
  assert.notEqual(a.builds[0].id, a.builds[1].id);
});

// --- storage --------------------------------------------------------------

test("saving, renaming and deleting", () => {
  saveBuild({ name: "First", role: "survivor", mode: "perks", keys: REAL });
  saveBuild({ name: "Second", role: "killer", mode: "perks", keys: ["adrenaline"] });

  let vault = getVault();
  assert.equal(vault.length, 2);
  assert.equal(vault[0].name, "Second", "newest first, like history");

  vault = renameBuild(vault[0].id, "Renamed");
  assert.equal(getVault()[0].name, "Renamed");

  vault = deleteBuild(vault[0].id);
  assert.equal(getVault().length, 1);
  assert.equal(getVault()[0].name, "First");
});

test("a rename to nothing keeps the old name", () => {
  saveBuild({ name: "Keep me", role: "survivor", mode: "perks", keys: REAL });
  const id = getVault()[0].id;
  renameBuild(id, "   ");
  assert.equal(getVault()[0].name, "Keep me");
});

test("an export round-trips back through the importer", () => {
  saveBuild({ name: "Round trip", role: "survivor", mode: "perks", keys: REAL });
  const text = exportVault();
  localStorage.clear();

  const result = importVaultFile(text);
  assert.equal(result.problem, null);
  assert.equal(result.added, 1);
  assert.equal(getVault()[0].name, "Round trip");
  assert.deepEqual(getVault()[0].keys, REAL);
});

test("importing merges rather than replacing", () => {
  saveBuild({ name: "Mine", role: "survivor", mode: "perks", keys: ["adrenaline"] });
  const result = importVaultFile(file([perkBuild("Theirs")]));

  assert.equal(result.added, 1);
  assert.equal(result.builds.length, 2, "what was already saved is still there");
  assert.deepEqual(
    result.builds.map((b) => b.name).sort(),
    ["Mine", "Theirs"],
  );
});

test("re-importing the same file adds nothing", () => {
  saveBuild({ name: "Mine", role: "survivor", mode: "perks", keys: REAL });
  const text = exportVault();

  const first = importVaultFile(text);
  assert.equal(first.added, 0);
  assert.equal(first.skipped, 1);

  const second = importVaultFile(text);
  assert.equal(second.skipped, 1);
  assert.equal(getVault().length, 1, "importing twice does not double the list");
});

test("a duplicate is the same build, whatever it is called", () => {
  saveBuild({ name: "Original name", role: "survivor", mode: "perks", keys: REAL });
  // Same perks in a different order, under a different name.
  const result = importVaultFile(file([perkBuild("Different name", [...REAL].reverse())]));
  assert.equal(result.added, 0);
  assert.equal(result.skipped, 1);
});

test("the same perks on the other side are not a duplicate", () => {
  saveBuild({ name: "Survivor one", role: "survivor", mode: "perks", keys: ["adrenaline"] });
  const result = importVaultFile(
    file([{ ...perkBuild("Killer one", ["adrenaline"]), role: "killer" }]),
  );
  assert.equal(result.added, 1, "role is part of what a build is");
});

test("a bad file leaves the saved vault exactly as it was", () => {
  saveBuild({ name: "Precious", role: "survivor", mode: "perks", keys: REAL });
  const before = JSON.stringify(getVault());

  for (const text of ["", "garbage", "[]", '{"app":"other"}']) {
    const result = importVaultFile(text);
    assert.ok(result.problem, `"${text}" should be refused`);
    assert.equal(result.added, 0);
  }
  assert.equal(JSON.stringify(getVault()), before, "nothing was touched");
});

test("a corrupt stored vault reads as empty rather than throwing", () => {
  for (const bad of ["not json", '{"not":"an array"}', "null", '["garbage", 42]']) {
    localStorage.setItem(STORAGE_KEY, bad);
    assert.deepEqual(getVault(), [], `"${bad}"`);
  }
});

test("stored ids survive a reload, so a delete keeps addressing the same row", () => {
  saveBuild({ name: "A", role: "survivor", mode: "perks", keys: ["adrenaline"] });
  saveBuild({ name: "B", role: "survivor", mode: "perks", keys: ["ace-in-the-hole"] });
  const ids = getVault().map((b: VaultBuild) => b.id);
  assert.deepEqual(
    getVault().map((b) => b.id),
    ids,
    "reading twice gives the same ids",
  );

  deleteBuild(ids[0]);
  assert.deepEqual(getVault().map((b) => b.id), [ids[1]]);
});
