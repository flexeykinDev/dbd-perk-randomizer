// Re-captures scripts/__fixtures__/perks-page.html — the real wiki markup
// that scripts/wiki-perk-table.test.ts runs against.
//
// Run it (`npm run capture:fixture`) when the Perks page genuinely changes
// shape and the parser has been updated to match, then read the diff: it
// is the clearest statement of what actually moved on the wiki. Do not run
// it to make a failing test pass — a fixture refreshed to match broken
// output is worse than no fixture, because it looks like coverage.
//
// The rows below are chosen, not sampled: each is a case the parser has
// been wrong about before, plus plain ones that prove it still works.
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as cheerio from "cheerio";

const HERE = dirname(fileURLToPath(import.meta.url));
const API = "https://deadbydaylight.wiki.gg/api.php";

/** Rows worth keeping: each is a case the parser has been wrong about
 *  before, or a plain one that proves it still works. */
const WANTED = [
  "Iron Will",
  "Adrenaline",
  "Hex: Ruin",
  "Scourge Hook: Pain Resonance",
  "Save the Best for Last",
  "Decisive Strike",
  "Made for This",
  // General perks — the ".All" sort-key row the parser has to normalise.
  "Kindred",
  "Whispers",
  // Both Davids, whose shared display name "David" is a real collision.
  "Dead Hard",
  "Detective's Hunch",
];

async function main() {
  const res = await fetch(`${API}?action=parse&page=Perks&format=json&prop=text`, {
    headers: { "User-Agent": "dbd-perk-randomizer fixture capture (personal site)" },
  });
  const html: string = (await res.json()).parse.text["*"];
  const $ = cheerio.load(html);

  const out: string[] = [];
  let kept = 0;
  $("table.wikitable").each((_, table) => {
    const $t = $(table);
    const header = $t
      .find("tr")
      .first()
      .find("th, td")
      .map((_, c) => $(c).text().replace(/\s+/g, " ").trim())
      .get()
      .join("|");
    if (header !== "Icon|Name|Description|Character") return;
    const rows = $t.find("tr").toArray();
    const body = rows
      .slice(1)
      .filter((tr) => WANTED.includes($(tr).find("th, td").eq(1).text().replace(/\s+/g, " ").trim()))
      .map((tr) => $.html(tr));
    kept += body.length;
    out.push(`<table class="wikitable">${$.html(rows[0])}${body.join("")}</table>`);
  });

  mkdirSync(join(HERE, "__fixtures__"), { recursive: true });
  writeFileSync(join(HERE, "__fixtures__", "perks-page.html"), out.join("\n") + "\n");
  console.log(`kept ${kept} rows across ${out.length} tables`);
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
