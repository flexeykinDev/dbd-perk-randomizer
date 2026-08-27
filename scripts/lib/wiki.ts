import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import sharp from "sharp";

/* The parts scrape-perks.ts and scrape-loadout.ts were both carrying.
 *
 * They fetch from the same MediaWiki API, download icons the same way, and
 * cache them against the same kind of key — and they had drifted into two
 * copies of each. That is not a tidiness complaint: the cache key originally
 * held only the source URL, so raising ICON_SIZE left every icon whose source
 * had not changed sitting at the old dimensions. It had to be found and fixed
 * twice, and both files still carry a near-identical comment about it. The
 * next such fix now has one place to go.
 */

/** Icons are stored at this size and the cache key includes it, so changing
 *  it re-downloads everything on the next run rather than silently leaving
 *  the old dimensions in place. */
export const ICON_SIZE = 256;

export function requestHeaders(scraper: string): Record<string, string> {
  return {
    "User-Agent": `vortex-info-next ${scraper} (personal site, contact via github)`,
  };
}

interface MediaWikiParseResponse {
  parse?: { text?: { "*"?: string } };
  error?: { info?: string };
}

/** The rendered HTML of a wiki page, via action=parse.
 *
 *  `followRedirects` matters for titles that are themselves redirects — a
 *  killer's name ("The Trapper") redirects to the character article ("Evan
 *  MacMillan"), and some offering titles have punctuation quirks that do the
 *  same. Off by default because a redirect that was not expected is usually a
 *  sign the caller asked for the wrong page. */
export async function fetchWikiPageHtml(
  apiBase: string,
  page: string,
  { headers, followRedirects = false }: { headers: Record<string, string>; followRedirects?: boolean },
): Promise<string> {
  const url =
    `${apiBase}?action=parse&page=${encodeURIComponent(page)}` +
    `${followRedirects ? "&redirects=1" : ""}&format=json&prop=text`;
  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`Failed to fetch ${page}: ${res.status} ${res.statusText}`);
  }
  const json = (await res.json()) as MediaWikiParseResponse;
  const html = json.parse?.text?.["*"];
  if (!html) {
    throw new Error(
      `Unexpected MediaWiki API response for ${page}: ${json.error?.info ?? "no parse.text.*"}`,
    );
  }
  return html;
}

/** Downloads an icon, resizes it, and records what was fetched.
 *
 *  The cache is compared against the SOURCE URL actually used, not merely
 *  "did some icon land here before" — the source is already in hand from the
 *  page fetch, so checking it is free, and it means a wiki-side art rework on
 *  an existing entry is picked up instead of the local copy staying stale
 *  forever. The output size is folded into the same value; see ICON_SIZE.
 *
 *  Returns the public path to reference the icon by. */
export async function downloadIcon({
  sourceUrl,
  destAbsolute,
  destRelative,
  cacheKey,
  cache,
  headers,
  label,
}: {
  sourceUrl: string;
  destAbsolute: string;
  destRelative: string;
  cacheKey: string;
  /** Mutated in place — the caller owns persisting it. */
  cache: Record<string, string>;
  headers: Record<string, string>;
  /** Names the entry in an error, so a failure says which one. */
  label: string;
}): Promise<string> {
  const cacheValue = `${sourceUrl}@${ICON_SIZE}`;
  if (cache[cacheKey] === cacheValue && existsSync(destAbsolute)) {
    return destRelative;
  }

  const res = await fetch(sourceUrl, { headers });
  if (!res.ok) {
    throw new Error(`Failed to download icon for ${label}: ${res.status} ${res.statusText}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());

  mkdirSync(dirname(destAbsolute), { recursive: true });
  await sharp(buffer)
    .resize(ICON_SIZE, ICON_SIZE, { fit: "cover", withoutEnlargement: true })
    .webp({ quality: 90 })
    .toFile(destAbsolute);

  // Records the URL actually fetched, override included — storing the wiki's
  // original here would never match on the next run and would re-download the
  // overridden icon every single time.
  cache[cacheKey] = cacheValue;
  return destRelative;
}

/** A JSON file that may not exist yet, as a plain object. */
export function loadJsonFile<T>(file: string, fallback: T): T {
  if (!existsSync(file)) return fallback;
  return JSON.parse(readFileSync(file, "utf8")) as T;
}

/** One named map out of a JSON file that may not exist yet. */
export function loadJsonMap(file: string, key: string): Record<string, string> {
  if (!existsSync(file)) return {};
  return (JSON.parse(readFileSync(file, "utf8")) as Record<string, Record<string, string>>)[key] ?? {};
}
