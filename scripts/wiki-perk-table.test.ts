// The parser that reads the wiki's HTML, run against real wiki HTML.
//
// This is the piece most exposed to someone else's markup changing, and
// the piece with the worst failure mode: a selector that stops matching
// doesn't throw, it returns fewer rows, and the pipeline ships a smaller
// site. It has been wrong three times already — the ".All" sort key read
// as a character name, the two Davids collapsing into one, and renamed
// perks importing "Identical to …" as their description — and until now
// the only way to exercise it was to hit the network.
//
// scripts/__fixtures__/perks-page.html is a real slice of the Perks page:
// the two real header rows plus eleven rows chosen because each is a case
// that has been got wrong, captured with scripts/_fixture.ts.
//
// What this does and doesn't prove: it pins the parser against markup that
// is known to have worked. It cannot notice the wiki changing tomorrow —
// only a real run does that. Re-capture the fixture when the page's shape
// genuinely changes, and let the diff show what moved.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parsePerkTables, resolveCharacterCollisions, cleanText } from "./wiki-perk-table";

const ORIGIN = "https://deadbydaylight.wiki.gg";
const html = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "__fixtures__", "perks-page.html"),
  "utf8",
);
const parsed = parsePerkTables(html, ORIGIN);
const all = [...parsed.survivor, ...parsed.killer];
const byName = (name: string) => {
  const row = all.find((r) => r.name === name);
  assert.ok(row, `"${name}" is missing from the fixture — re-capture it`);
  return row;
};

test("both role tables are found, and in page order", () => {
  // The first qualifying table is Survivor and the second Killer. wiki.gg
  // opens the page with an unrelated Prestige/Inventory table, which is
  // why the tables are located by their header row rather than by index.
  assert.ok(parsed.survivor.length >= 4, `survivor rows: ${parsed.survivor.length}`);
  assert.ok(parsed.killer.length >= 3, `killer rows: ${parsed.killer.length}`);
  assert.ok(parsed.survivor.some((r) => r.name === "Iron Will"));
  assert.ok(parsed.killer.some((r) => r.name === "Hex: Ruin"));
});

test("a plain row comes out whole", () => {
  const row = byName("Iron Will");
  assert.equal(row.slug, "iron-will");
  assert.equal(row.character, "Jake");
  assert.equal(row.characterFullName, "Jake Park");
  assert.equal(row.upcoming, false);
  assert.equal(row.renamedTo, undefined);
  assert.match(row.description, /meditative-like state/);
});

test("root-relative image URLs are made absolute", () => {
  // wiki.gg puts a root-relative path straight on `src`; Fandom lazy-loads
  // and hides the real one on `data-src`. Both have to end up absolute or
  // the download step silently fetches nothing.
  for (const row of all) {
    assert.ok(
      row.iconSourceUrl.startsWith(`${ORIGIN}/`),
      `${row.slug}: icon URL not absolute — ${row.iconSourceUrl}`,
    );
  }
  assert.ok(byName("Iron Will").characterPortraitUrl.startsWith(`${ORIGIN}/`));
});

test('the ".All" sort key is normalised, not taken as a character name', () => {
  // Both wikis prefix general-perk rows with an invisible character so they
  // sort above the named ones: `<span class="display-none">.</span>All`.
  // Read literally that is a character called ".All", which is what used to
  // reach the shipped data.
  const general = all.filter((r) => r.character === "All");
  assert.ok(general.length >= 2, `expected general perks in the fixture, got ${general.length}`);
  assert.deepEqual(
    all.filter((r) => r.character.startsWith(".")).map((r) => r.name),
    [],
    "a row still carries the leading sort-key dot",
  );
});

test("a renamed perk is flagged rather than importing its pointer as text", () => {
  // When a licence lapses the perk is renamed and the old row becomes a
  // pointer: "Identical to Will to Live. …". Taken at face value that
  // overwrites a well-known perk's description with those words.
  const renamed = byName("Decisive Strike");
  assert.equal(renamed.renamedTo, "will-to-live");
  assert.equal(byName("Save the Best for Last").renamedTo, "keep-them-waiting");

  // And a perk that hasn't been renamed must not be flagged.
  assert.equal(byName("Iron Will").renamedTo, undefined);
});

test("an upcoming-patch row is marked, and the notice stripped from its text", () => {
  const upcoming = all.filter((r) => r.upcoming);
  assert.ok(upcoming.length > 0, "the fixture no longer contains an upcoming row — re-capture it");
  for (const row of upcoming) {
    assert.doesNotMatch(
      row.description,
      /^This description is based on the changes announced/,
      `${row.slug}: the patch notice is still in the description`,
    );
  }
});

test("two characters sharing a display name are told apart, and nobody else is touched", () => {
  // The table shows only a first name, which is unique until it isn't:
  // David King and David Tapp both render as "David".
  const before = all.map((r) => r.character);
  const rows = all.map((r) => ({ ...r }));
  resolveCharacterCollisions(rows);

  const davids = rows.filter((r) => r.characterFullName.startsWith("David"));
  assert.equal(davids.length, 2, "the fixture should carry both Davids");
  assert.deepEqual(
    [...new Set(davids.map((r) => r.character))].sort(),
    ["David King", "David Tapp"],
    "the two Davids were not separated",
  );

  // Everyone else keeps the short display name they came in with — this is
  // the half that stops a collision fix from renaming eighty characters.
  const untouched = rows.filter((r) => !r.characterFullName.startsWith("David"));
  assert.deepEqual(
    untouched.map((r) => r.character),
    before.filter((_, i) => !all[i].characterFullName.startsWith("David")),
  );
});

test("cleanText collapses the whitespace the wiki's markup leaves behind", () => {
  assert.equal(cleanText("  a \n  b\t c  "), "a b c");
});
