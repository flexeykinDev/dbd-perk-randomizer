// Does the shipped data say what BHVR says?
//
//   npm run check:patch-notes
//
// Reads the newest live patch notes from Steam and compares every perk they
// mention against the description this site ships. Prints what disagrees and
// exits non-zero, so it can gate a release or just be run after a scrape.
//
// It never writes. A disagreement is not automatically the wiki being wrong —
// it can be a rework whose prose moved the numbers around, or a perk the wiki
// has corrected and the notes have not. The fix, when there is one, is an entry
// in data/overrides/perks.json, written by a person who looked.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { disagreements, fetchPatchNotes } from "./patch-notes";

const dataDir = join(dirname(fileURLToPath(import.meta.url)), "..", "data");

interface Perk {
  slug: string;
  name: { en: string };
}
/* data/perk-descriptions.json is an OBJECT keyed by slug, and its entries do
   not repeat the slug inside. Reading it as a list of records produced a map of
   `undefined -> text`, every description came back empty, and the checker
   cheerfully reported 68 disagreements on its first run — a checker that claims
   everything is broken is as useless as one that claims nothing is. */
type DescriptionFile = Record<string, { description?: string }>;

function shippedDescriptions(): Map<string, { slug: string; description: string }> {
  const perks = JSON.parse(readFileSync(join(dataDir, "perks.json"), "utf8")) as Perk[];
  const bySlug = JSON.parse(
    readFileSync(join(dataDir, "perk-descriptions.json"), "utf8"),
  ) as DescriptionFile;
  return new Map(
    perks.map((p) => [
      p.name.en.toLowerCase(),
      { slug: p.slug, description: bySlug[p.slug]?.description ?? "" },
    ]),
  );
}

async function main() {
  const notes = await fetchPatchNotes();
  if (!notes) {
    console.log("No live patch notes with perk changes found — nothing to check.");
    return;
  }

  const shipped = shippedDescriptions();
  const problems = disagreements(notes.perks, shipped);
  const checked = notes.perks.filter((p) => shipped.has(p.name.toLowerCase())).length;

  console.log(`Checked against "${notes.title}" (${notes.date.toISOString().slice(0, 10)})`);
  console.log(`  ${notes.url}`);
  console.log(
    `  ${notes.perks.length} perks in the notes, ${checked} of them shipped here, ` +
      `${checked - problems.length} agree\n`,
  );

  if (problems.length === 0) {
    console.log("Every perk the notes mention states the same values here.");
    return;
  }

  for (const p of problems) {
    console.log(`  ${p.perk}${p.rework ? "  (marked a rework)" : ""}`);
    console.log(`     notes say : ${p.expected.join(", ")}`);
    console.log(`     we say    : ${p.found.join(", ") || "(no tier values in our text)"}`);
    console.log(`     slug      : ${p.slug}`);
  }

  console.log(
    `\n${problems.length} perk${problems.length === 1 ? "" : "s"} disagree with the official notes.\n` +
      `  The usual cause is the wiki documenting the PTB build: BHVR changes a value\n` +
      `  between the PTB and the live release and the wiki is not always corrected.\n` +
      `  Check the game, then record the live value in data/overrides/perks.json and\n` +
      `  re-run \`npm run scrape:perks\`. Delete the entry once the wiki catches up.`,
  );
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
