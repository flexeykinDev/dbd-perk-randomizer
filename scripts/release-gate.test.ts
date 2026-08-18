// Guards the guard. release-gate.ts is the only thing standing between
// wiki.gg's pre-release pages and the live randomizer, and it fails in a
// direction nobody notices: if it silently started treating every date as
// released, the data would simply gain a Chapter early and look fine. Run
// by `npm test`, which CI runs on every push.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isReleased, partitionByRelease, ReleaseDateError } from "./release-gate";

const NOW = new Date("2026-08-18T12:00:00Z");

test("a past date counts as released", () => {
  assert.equal(isReleased("2025-09-23", "x", NOW), true);
});

test("release day itself counts as released", () => {
  assert.equal(isReleased("2026-08-18", "x", NOW), true);
});

test("a future date is held back", () => {
  assert.equal(isReleased("2026-08-19", "x", NOW), false);
  assert.equal(isReleased("2026-08-25", "x", NOW), false);
});

test("a missing or malformed date throws rather than guessing", () => {
  // Both defaults would be wrong: "released" ships unreleased content,
  // "unreleased" silently drops a hand-authored entry.
  for (const bad of [undefined, "", "   ", "25 Aug 2026", "2026-8-5", "2026/08/05"]) {
    assert.throws(() => isReleased(bad, "Entry", NOW), ReleaseDateError, `expected throw for ${JSON.stringify(bad)}`);
  }
});

test("partitionByRelease splits and reports what it held", () => {
  const { live, pending } = partitionByRelease(
    [
      { n: "Krasue", d: "2025-09-23" },
      { n: "Judgment", d: "2026-08-25" },
      { n: "Slasher", d: "2026-06-16" },
    ],
    (e) => e.d,
    (e) => e.n,
    NOW,
  );
  assert.deepEqual(live.map((e) => e.n), ["Krasue", "Slasher"]);
  assert.deepEqual(pending.map((p) => p.entry.n), ["Judgment"]);
});

// The shipped data files are the actual thing being protected, so assert
// against them directly rather than only against synthetic entries.
const dataDir = join(dirname(fileURLToPath(import.meta.url)), "../data");
for (const file of ["supplemental-perks.en.json", "supplemental-addons.en.json"]) {
  test(`every entry in ${file} has a usable releasedAt`, () => {
    const raw = JSON.parse(readFileSync(join(dataDir, file), "utf8"));
    const entries: { character: string; releasedAt?: string }[] = raw.entries ?? [];
    assert.ok(entries.length > 0, `${file} has no entries`);
    for (const entry of entries) {
      assert.doesNotThrow(
        () => isReleased(entry.releasedAt, entry.character, NOW),
        `${entry.character} in ${file} has a missing/malformed releasedAt`,
      );
    }
  });
}
