// Diffs the Perks page as Fandom renders it against the same page on
// wiki.gg, and reports what switching source would actually change.
//
// Why this exists rather than just doing the switch: Fandom lags real
// chapter releases by months, which is the whole case for moving, but
// wiki.gg publishes content *before* it ships, which is a live hazard for
// a site whose data pipeline runs unattended on a schedule. The decision
// therefore rests on specifics — how many perks appear, how many are
// pre-release, whether any character key or perk slug would churn — and
// those change every week as both wikis are edited. A one-off manual
// comparison would be stale by the time it was acted on; this can be
// re-run.
//
// Read-only: fetches, prints, exits. It never writes data/ and is not
// wired into CI. Run it with `npm run compare:sources`.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parsePerkTables, type ScrapedRow } from "./wiki-perk-table";
import type { Perk, PerkRole } from "../lib/types";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PERKS_JSON = join(__dirname, "../data/perks.json");

interface Source {
  label: string;
  origin: string;
  api: string;
}

const SOURCES: Source[] = [
  {
    label: "fandom",
    origin: "https://deadbydaylight.fandom.com",
    api: "https://deadbydaylight.fandom.com/api.php?action=parse&page=Perks&format=json&prop=text",
  },
  {
    label: "wiki.gg",
    origin: "https://deadbydaylight.wiki.gg",
    api: "https://deadbydaylight.wiki.gg/api.php?action=parse&page=Perks&format=json&prop=text",
  },
];

// Both wikis sit behind a bot filter that answers a default fetch() with a
// challenge page rather than JSON; a browser UA gets the real response.
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const ROLES: PerkRole[] = ["survivor", "killer"];

async function fetchRows(source: Source): Promise<Record<PerkRole, ScrapedRow[]>> {
  const response = await fetch(source.api, { headers: { "User-Agent": USER_AGENT } });
  if (!response.ok) {
    throw new Error(`${source.label}: HTTP ${response.status} ${response.statusText}`);
  }
  const json = (await response.json()) as { parse?: { text?: { "*"?: string } } };
  const html = json.parse?.text?.["*"];
  if (!html) throw new Error(`${source.label}: response carried no parsed HTML`);
  return parsePerkTables(html, source.origin);
}

function flatten(byRole: Record<PerkRole, ScrapedRow[]>): Map<string, ScrapedRow & { role: PerkRole }> {
  const out = new Map<string, ScrapedRow & { role: PerkRole }>();
  for (const role of ROLES) {
    for (const row of byRole[role]) out.set(`${role}/${row.slug}`, { ...row, role });
  }
  return out;
}

function heading(text: string): void {
  console.log(`\n${text}\n${"-".repeat(text.length)}`);
}

async function main() {
  const [fandom, wikigg] = await Promise.all(SOURCES.map(fetchRows));
  const a = flatten(fandom);
  const b = flatten(wikigg);
  const shipped = new Map(
    (JSON.parse(readFileSync(PERKS_JSON, "utf8")) as Perk[]).map((p) => [`${p.role}/${p.slug}`, p]),
  );

  heading("Totals");
  for (const [label, rows] of [
    ["fandom ", a],
    ["wiki.gg", b],
  ] as const) {
    const survivor = [...rows.values()].filter((r) => r.role === "survivor").length;
    console.log(`  ${label}  ${rows.size} perks (${survivor} survivor, ${rows.size - survivor} killer)`);
  }
  console.log(`  shipped  ${shipped.size} perks in data/perks.json`);

  // The reason to move. Anything here is a perk players have in-game that
  // the site can't roll, unless a supplemental entry is already covering it.
  const onlyWikigg = [...b.keys()].filter((k) => !a.has(k));
  heading(`On wiki.gg but not on Fandom (${onlyWikigg.length})`);
  for (const key of onlyWikigg) {
    const row = b.get(key)!;
    const covered = shipped.has(key) ? " [already shipped via supplemental]" : "";
    const flag = row.upcoming ? " [UPCOMING PATCH]" : "";
    console.log(`  + ${key} — ${row.name} (${row.character})${flag}${covered}`);
  }

  // The reason to be careful. wiki.gg documents chapters before release, so
  // these would go live the moment the scheduled scrape ran.
  const upcoming = [...b.values()].filter((r) => r.upcoming);
  heading(`Marked as an upcoming patch on wiki.gg (${upcoming.length})`);
  for (const row of upcoming) console.log(`  ! ${row.role}/${row.slug} — ${row.name} (${row.character})`);

  const onlyFandom = [...a.keys()].filter((k) => !b.has(k));
  heading(`On Fandom but not on wiki.gg (${onlyFandom.length})`);
  for (const key of onlyFandom) {
    const row = a.get(key)!;
    console.log(`  - ${key} — ${row.name} (${row.character})`);
  }

  // `character` is a key, not a label: it maps to portraits, to the RU
  // character translations, and to whatever the player has selected in
  // localStorage. Churn here is a migration, not a data refresh.
  heading("Character-name differences on shared perks");
  const pairs = new Map<string, string[]>();
  for (const [key, row] of b) {
    const other = a.get(key);
    if (!other || other.character === row.character) continue;
    const pair = `${other.character} -> ${row.character}`;
    pairs.set(pair, [...(pairs.get(pair) ?? []), key]);
  }
  if (pairs.size === 0) console.log("  (none)");
  for (const [pair, keys] of [...pairs].sort((x, y) => y[1].length - x[1].length)) {
    console.log(`  ${pair} (${keys.length} perks, e.g. ${keys[0]})`);
  }

  // Descriptions are what the Core Effect derivation reads, so a wholesale
  // rewording is a bigger deal than the count alone suggests — see
  // lib/perk-description.test.ts.
  const shared = [...b.keys()].filter((k) => a.has(k));
  const reworded = shared.filter((k) => a.get(k)!.description !== b.get(k)!.description);
  heading(`Description differs on ${reworded.length} of ${shared.length} shared perks`);
  for (const key of reworded.slice(0, 5)) {
    console.log(`  ${key}`);
    console.log(`    fandom : ${a.get(key)!.description.slice(0, 150)}`);
    console.log(`    wiki.gg: ${b.get(key)!.description.slice(0, 150)}`);
  }
  if (reworded.length > 5) console.log(`  ... and ${reworded.length - 5} more`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
