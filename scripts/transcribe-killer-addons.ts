// Transcribes one killer's Power add-ons from that killer's own wiki page
// into data/supplemental-addons.en.json.
//
//   npx tsx scripts/transcribe-killer-addons.ts "The Judgment" Judgment 2026-08-25
//
// Why this exists: scrape-loadout.ts reads the wiki's central "Add-ons" page,
// and that page lags a chapter by weeks — it had no mention of The Judgment
// at all four days after release, while the killer's own page already listed
// all twenty. The supplemental file is the designed escape hatch for that
// gap (see its own _comment), and this is the thing that fills it.
//
// Deliberately a transcriber, not a second scraper. It writes only the
// supplemental file, it never touches addons.json, and every entry it adds is
// meant to be deleted once the central page catches up — removing it and
// re-running the loadout scrape is how you check whether it is still needed.
//
// The add-on table only exists in the RENDERED page: the wikitext is a Lua
// module call (`{{#Invoke:Loadout|getAddonsByOwner}}`), so `prop=wikitext`
// comes back with nothing useful and `prop=text` is required.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "data", "supplemental-addons.en.json");
const API = "https://deadbydaylight.wiki.gg/api.php";
const WIKI = "https://deadbydaylight.wiki.gg";
const UA = { "user-agent": "dbd-perk-randomizer/transcribe-killer-addons" };

interface Addon {
  name: string;
  description: string;
  iconSourceUrl: string;
}

/** HTML to the flat sentence the loadout pipeline expects. The wiki marks
 *  values up with nested spans, so tags come out and entities go back to
 *  characters; `&#37;` in particular is a literal percent that would
 *  otherwise survive into the UI. */
function text(html: string): string {
  return html
    .replace(/<\/li>/g, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    // The wiki puts a space either side of every marked-up number, which
    // reads as "2 / 2.5 / 3 seconds ." once the tags are gone.
    .replace(/\s+([.,])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/* The flavour quote's source citation has to go, and it is not cosmetic.
 *
 * These add-ons open with a quote AND a citation — `"…the mark." — (III On
 * Heresy, ch. 3) When a cast Divine Light passes…` — while the existing
 * supplemental entries carry the quote alone. lib/perk-description.ts reads
 * an em-dash after a closing quote as "attribution follows, to the end of the
 * string", which is true when the lore quote TRAILS the description, as it
 * does everywhere else on the wiki. Here the quote leads, so that rule ate
 * the citation and the entire mechanic behind it: Heretic's Mark derived an
 * empty Core Effect.
 *
 * Dropping the citation leaves a bare leading quote, which is the shape the
 * pipeline already handles — stripLoreIntro moves it out of Core and Full
 * Text keeps it.
 */
function dropQuoteAttribution(description: string): string {
  return description.replace(/^("[^"]*")\s*[—-]\s*\([^)]*\)\s*/, "$1 ").trim();
}

async function fetchRendered(page: string): Promise<string> {
  const url = `${API}?action=parse&format=json&prop=text&page=${encodeURIComponent(page)}`;
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`${page}: wiki returned ${res.status}`);
  const body = (await res.json()) as { parse?: { text?: { "*": string } }; error?: { info: string } };
  if (body.error) throw new Error(`${page}: ${body.error.info}`);
  const html = body.parse?.text?.["*"];
  if (!html) throw new Error(`${page}: no rendered HTML`);
  return html;
}

function extractAddons(html: string, page: string): Addon[] {
  // The heading id is "Add-ons_for_<Power name>", and the Power name is not
  // knowable up front — match the prefix. Search from the LAST occurrence,
  // because the table of contents carries the same text earlier in the page
  // and matching that yields four rows of perks instead of the add-ons.
  const anchor = /id="Add-ons_for_[^"]*"/g;
  let start = -1;
  for (const m of html.matchAll(anchor)) start = m.index ?? start;
  if (start < 0) throw new Error(`${page}: no "Add-ons for …" section on the page`);

  const after = html.slice(start);
  const rows = [...after.matchAll(/<tr[\s\S]*?<\/tr>/g)].map((m) => m[0]);

  const addons: Addon[] = [];
  for (const row of rows) {
    // Header row carries <th>Icon</th>; a real row carries an <img> and a
    // description cell.
    const icon = row.match(/<img[^>]+src="([^"]*\/images\/[^"?]+\.png)[^"]*"/i);
    const name = row.match(/<a href="\/wiki\/[^"]+" title="([^"]+)"[^>]*>(?:(?!<img)[\s\S])*?<\/a>/);
    const desc = row.match(/<td[^>]*>([\s\S]*?)<\/td>/);
    if (!icon || !name || !desc) continue;

    const description = dropQuoteAttribution(text(desc[1]));
    if (!description) continue;
    addons.push({
      name: text(name[1]),
      description,
      iconSourceUrl: `${WIKI}${icon[1]}`,
    });
  }
  // Stop early rather than write a half-read table: a page whose markup moved
  // should fail loudly here, not produce a killer with three add-ons.
  if (addons.length < 4) {
    throw new Error(
      `${page}: only found ${addons.length} add-ons — the page markup has probably moved`,
    );
  }
  return addons;
}

async function main(): Promise<void> {
  const [page, character, releasedAt] = process.argv.slice(2);
  if (!page || !character) {
    console.error(
      'Usage: npx tsx scripts/transcribe-killer-addons.ts "<Wiki page>" <CharacterKey> [YYYY-MM-DD]',
    );
    process.exitCode = 1;
    return;
  }

  console.log(`Reading ${page} ...`);
  const addons = extractAddons(await fetchRendered(page), page);
  console.log(`Found ${addons.length} add-ons for "${character}".`);

  const file = existsSync(OUT)
    ? (JSON.parse(readFileSync(OUT, "utf8")) as { _comment?: string; entries?: unknown[] })
    : { entries: [] };
  const entries = (file.entries ?? []) as { character: string }[];
  const next = { character, ...(releasedAt ? { releasedAt } : {}), addons };
  const at = entries.findIndex((e) => e.character === character);
  if (at >= 0) {
    entries[at] = next;
    console.log(`Replaced the existing "${character}" entry.`);
  } else {
    entries.push(next);
  }

  writeFileSync(OUT, JSON.stringify({ ...file, entries }, null, 2) + "\n");
  console.log(`Wrote ${OUT}`);
  console.log("Run `npm run scrape:loadout` to fold these into data/addons.json.");
  for (const a of addons.slice(0, 3)) console.log(`  • ${a.name}: ${a.description.slice(0, 90)}…`);
}

main().catch((error) => {
  console.error(String(error instanceof Error ? error.message : error));
  process.exitCode = 1;
});
