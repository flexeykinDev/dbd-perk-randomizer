/* Is there a patch the wiki has not caught up with yet?
 *
 * The weekly scrape trusts the wiki, and the wiki lags BHVR. On 1 September
 * the 10.1.1 notes changed Repressed Alliance and Vigil, and a scrape run that
 * day returned the old numbers with nothing to say anything was wrong — the
 * only reason we noticed is that somebody read the patch notes and said so.
 *
 * This does NOT parse patch notes into perk data. They are prose, the format
 * shifts patch to patch, and a parser would fail silently, which is the exact
 * failure it would be trying to prevent. It answers one question: has BHVR
 * shipped a patch since the data was last scraped? A human reads the notes.
 *
 * Steam's public news API, not the store page: the page is a single-page app
 * that serves a shell to anything without a browser, and the API returns the
 * same posts as JSON with no key and no scraping.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DBD_APP_ID = 381210;
const API = `https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=${DBD_APP_ID}&count=10&maxlength=1`;

interface NewsItem {
  title: string;
  url: string;
  date: number;
}

/** A patch, as opposed to a sale, a Top Sellers list or a blog post. BHVR
 *  titles theirs "10.1.1 | Bugfix Patch", "10.1.0 | Chorus of Sin". */
function isPatch(title: string): boolean {
  return /^\d+\.\d+\.\d+\s*\|/.test(title.trim());
}

async function main(): Promise<void> {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const scrapedAt = new Date(
    (JSON.parse(readFileSync(join(root, "data/meta.json"), "utf8")) as { scrapedAt: string })
      .scrapedAt,
  );

  let items: NewsItem[];
  try {
    const res = await fetch(API);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    items = ((await res.json()) as { appnews?: { newsitems?: NewsItem[] } }).appnews?.newsitems ?? [];
  } catch (err) {
    // Never fail the scrape over this. It is a note for a human, not a gate.
    console.log(`Could not reach Steam's news API (${String(err)}). Skipping the patch check.`);
    return;
  }

  const newer = items
    .filter((n) => isPatch(n.title) && n.date * 1000 > scrapedAt.getTime())
    .sort((a, b) => b.date - a.date);

  if (newer.length === 0) {
    console.log(`No DBD patch since the last scrape (${scrapedAt.toISOString().slice(0, 10)}).`);
    return;
  }

  console.log(`::warning::${newer.length} DBD patch(es) since the last scrape — the wiki may be behind.`);
  for (const n of newer) {
    console.log(`  ${new Date(n.date * 1000).toISOString().slice(0, 10)}  ${n.title}`);
    console.log(`    ${n.url}`);
  }
  console.log(
    "\nThe wiki is scraped, not the notes. If a perk changed and the wiki has not\n" +
      "caught up, put the corrected text in data/overrides/perks.json — it is\n" +
      "superseded automatically once the wiki agrees.",
  );
}

void main();
