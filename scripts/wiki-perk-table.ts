// Reading the wiki's Perks page into rows, kept separate from the scraper
// that writes data/perks.json so the same parse can be run against a
// *different* wiki without touching the pipeline.
//
// That matters because the project's data source is under review: Fandom's
// Perks page lags real chapter releases by months, while wiki.gg is current
// (see scripts/compare-sources.ts, which diffs the two). Whatever that
// decision ends up being, the parsing had to stop assuming one wiki's exact
// markup first — the two render the same table three different ways:
//
//   * Fandom serves icons lazily, with the real URL on `data-src` and an
//     absolute href carrying a `/revision/...` cache-buster. wiki.gg puts a
//     root-relative URL straight on `src`.
//   * wiki.gg opens the page with an unrelated Prestige/Inventory table, so
//     the perk tables are not at a fixed index.
//   * wiki.gg prefixes the Character column with a hidden sort key —
//     `<span class="display-none">.</span>All` — which reads as ".All" if
//     you take the cell's text at face value.
//
// None of that is exotic; it is just what happens when a selector is
// written against one page. Selecting on the header row and accepting
// either image attribute costs nothing on Fandom and is what a second
// source needs.
import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import { slugify } from "../lib/slugify";
import { resolveImageUrl } from "./wiki-source";
import type { PerkRole } from "../lib/types";

export interface ScrapedRow {
  name: string;
  slug: string;
  description: string;
  character: string;
  // The wiki's Perks table displays only a character's first name (or, for
  // Killers, their epithet) in the character column — almost always unique
  // enough on its own, until two characters happen to share one (David
  // King and David Tapp both show as bare "David"). The character link's
  // `title` attribute still disambiguates them even though the visible
  // text doesn't, so that's captured here too and only substituted in for
  // `character` when a real collision is detected (see
  // resolveCharacterCollisions) — every non-colliding character keeps its
  // existing short display form unchanged.
  characterFullName: string;
  iconSourceUrl: string;
  characterPortraitUrl: string;
  /** Set when this row is only a pointer to the perk's current name (see
   *  RENAMED_PERK_NOTICE) — the slug of whatever it now goes by. The row
   *  carries no description of its own and must not be shipped as one. */
  renamedTo?: string;
  /** True when the wiki is describing a patch that hasn't shipped yet.
   *  Kept rather than just stripped, because on a source that publishes
   *  pre-release content it's the signal that a row may not be live. */
  upcoming: boolean;
}

/** The Perks page's own column headings, used to find the two perk tables
 *  by what they contain instead of where they sit. */
const PERK_TABLE_HEADER = "Icon|Name|Description|Character";

const UPCOMING_PATCH_NOTICE =
  /^This description is based on the changes announced for or featured in the upcoming Patch [\d.]+\s*/;

// When a licence lapses, BHVR keeps the perk but renames it and makes it
// general — Hellraiser and Halloween both ended, so Decisive Strike is now
// Will to Live, Dying Light is Cull the Weak, Deadlock is No Holds Barred,
// and so on. wiki.gg documents that by keeping the retired name as a row
// whose entire description is a pointer:
//
//   Decisive Strike | "Identical to Will to Live. "There is nothing to be
//                   |  scared of." — Laurie"
//
// Fandom never recorded the change, which is why the shipped data still
// has the old names with real descriptions. Taken at face value these rows
// would overwrite eight well-known perks with the words "Identical to …",
// so they're recognised and handled rather than parsed as content.
const RENAMED_PERK_NOTICE = /^Identical to (.+?)\.\s/;

export function cleanText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** The attribute actually holding an image's URL. Fandom lazy-loads and
 *  puts the real file on `data-src`, leaving `src` as a placeholder;
 *  wiki.gg puts it straight on `src`. See resolveImageUrl. */
function imageSrc(img: cheerio.Cheerio<AnyNode>): string | undefined {
  return img.attr("data-src") ?? img.attr("src");
}


/**
 * Parses both perk tables off a rendered Perks page.
 *
 * @param origin  Scheme + host of the wiki the HTML came from, used to
 *                absolutise root-relative image URLs.
 * @returns Rows per role, in page order. The first qualifying table is the
 *          Survivor one and the second the Killer one — that ordering is
 *          the page's own and is the same on both wikis.
 */
export function parsePerkTables(
  html: string,
  origin: string,
): Record<PerkRole, ScrapedRow[]> {
  const $ = cheerio.load(html);
  const out: Record<PerkRole, ScrapedRow[]> = { survivor: [], killer: [] };
  const roles: PerkRole[] = ["survivor", "killer"];
  let tableIndex = 0;

  $("table.wikitable").each((_, table) => {
    const header = $(table)
      .find("tr")
      .first()
      .find("th, td")
      .map((_, cell) => cleanText($(cell).text()))
      .get()
      .join("|");
    if (header !== PERK_TABLE_HEADER) return;
    const role = roles[tableIndex++];
    if (!role) return; // a third matching table would be new; ignore it

    $(table)
      .find("tr")
      .each((i, tr) => {
        if (i === 0) return; // header row
        const cells = $(tr).find("th, td");
        if (cells.length < 4) return;

        const iconCell = cells.eq(0);
        const nameCell = cells.eq(1);
        const descriptionCell = cells.eq(2);
        const characterCell = cells.eq(3);

        const name = cleanText(nameCell.text());
        const iconSourceUrl = resolveImageUrl(imageSrc(iconCell.find("img").first()), origin);
        if (!name || !iconSourceUrl) return;

        const rawDescription = cleanText(descriptionCell.text());
        const upcoming = UPCOMING_PATCH_NOTICE.test(rawDescription);
        // Taken verbatim, hidden sort key and all. Both wikis prefix the
        // general-perk rows with an invisible character so they sort ahead
        // of the named ones — `<span class="display-none">.</span>All` —
        // and the leading dot therefore survives into the text. That looks
        // like something to strip, but it is load-bearing: ".All" is the
        // sentinel lib/perks.ts checks to keep general perks out of the
        // character picker (getCharactersForRole), and it is what the 27
        // perks and 47 add-ons already shipped are keyed on. Both wikis
        // produce the same string, so preserving it is also what keeps the
        // two sources interchangeable. Renaming it is a data migration in
        // its own right, not a parser detail.
        const character = cleanText(characterCell.text());

        const renamedMatch = RENAMED_PERK_NOTICE.exec(rawDescription);

        out[role].push({
          name,
          slug: slugify(name),
          description: rawDescription.replace(UPCOMING_PATCH_NOTICE, ""),
          renamedTo: renamedMatch ? slugify(renamedMatch[1]) : undefined,
          character,
          characterFullName: characterCell.find("a").first().attr("title") || character,
          iconSourceUrl,
          characterPortraitUrl: resolveImageUrl(
            imageSrc(characterCell.find(".charPortraitWrapper img").first()),
            origin,
          ),
          upcoming,
        });
      });
  });

  return out;
}

// Almost every character's wiki-table display name (first name, or a
// Killer's bare epithet) is unique on its own — until it isn't (David King
// vs David Tapp, both shown as just "David"). Only swap in the longer,
// disambiguated name for rows whose short display name is actually shared
// by more than one distinct character; every other row's `character` is
// left exactly as scraped, so this can't change any of the ~80 already-
// correct display values sitewide.
export function resolveCharacterCollisions(rows: ScrapedRow[]): void {
  const fullNamesByDisplay = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!row.character) continue;
    const set = fullNamesByDisplay.get(row.character) ?? new Set();
    set.add(row.characterFullName);
    fullNamesByDisplay.set(row.character, set);
  }
  for (const row of rows) {
    const fullNames = fullNamesByDisplay.get(row.character);
    if (fullNames && fullNames.size > 1) {
      row.character = row.characterFullName;
    }
  }
}
