// The handful of things that differ between the two DBD wikis, in one
// place so both scrapers agree about them.
//
// The EN data has historically come from deadbydaylight.fandom.com, which
// lags real Chapter releases by months. deadbydaylight.wiki.gg is current
// but publishes a Chapter page as soon as it is announced, weeks before it
// ships. Moving between them is therefore not a URL change — see
// `WikiSource.publishesPreRelease` below, and `npm run compare:sources`
// for what a move would actually change.

export interface WikiSource {
  /** Human-readable page URL, recorded in the data's meta as its origin. */
  wikiBase: string;
  /** MediaWiki `api.php`, which returns the same rendered HTML as the page
   *  without Fandom's Cloudflare JS challenge in the way. */
  apiBase: string;
  /** Scheme + host, for absolutising root-relative image URLs. */
  origin: string;
  /** Whether this wiki documents content before it releases.
   *
   *  The single most important field here. Fandom documents a character
   *  once it is live, so anything it lists can ship immediately. wiki.gg
   *  does the opposite, so on that source every unrecognised character is
   *  held back until someone records its release date (see
   *  gateScrapedRows in scripts/release-gate.ts). Changing the URLs
   *  without changing this would publish an unreleased Chapter on the next
   *  scheduled run, with nobody watching. */
  publishesPreRelease: boolean;
}

export const FANDOM: WikiSource = {
  wikiBase: "https://deadbydaylight.fandom.com/wiki",
  apiBase: "https://deadbydaylight.fandom.com/api.php",
  origin: "https://deadbydaylight.fandom.com",
  publishesPreRelease: false,
};

export const WIKI_GG: WikiSource = {
  wikiBase: "https://deadbydaylight.wiki.gg/wiki",
  apiBase: "https://deadbydaylight.wiki.gg/api.php",
  origin: "https://deadbydaylight.wiki.gg",
  publishesPreRelease: true,
};

/**
 * Turns whatever an `<img>` on a wiki page points at into an absolute URL.
 *
 * The two wikis disagree three ways, none of them exotic — just what
 * happens when a selector is written against one page:
 *
 *   * Fandom lazy-loads, so `src` is a placeholder and the real file is on
 *     `data-src`. wiki.gg doesn't, so `src` is the real thing and
 *     `data-src` is absent. Hence `data-src` first, then `src`.
 *   * Fandom appends a `/revision/latest?cb=…` cache-buster path segment;
 *     the file is everything before it.
 *   * wiki.gg serves root-relative URLs (`/images/…`), which need the
 *     wiki's own origin put back on the front.
 */
export function resolveImageUrl(
  raw: string | undefined,
  origin: string,
): string {
  if (!raw) return "";
  const url = raw.split("/revision/")[0];
  const absolute = url.startsWith("//")
    ? `https:${url}`
    : url.startsWith("/")
      ? `${origin}${url}`
      : url;
  return preferFullSize(absolute);
}

/**
 * Points a MediaWiki thumbnail URL at the file it is a thumbnail of.
 *
 * The `<img>` in a wiki table is sized for the wiki's own layout — on
 * wiki.gg that is a 96px thumb:
 *
 *   /images/thumb/IconPerks_adrenaline.png/96px-IconPerks_adrenaline.png
 *   /images/IconPerks_adrenaline.png                       <- 256x256
 *
 * Taking the thumb at face value meant every perk and add-on icon carried
 * 96 pixels of real detail and was then *enlarged* to 128 on the way to
 * disk, which is worse than useless: it costs bytes to store blur. The
 * originals have been 256x256 the whole time, which is what the character
 * portraits already used.
 *
 * Requesting a specific larger thumb (`256px-…`) would work equally well
 * today and break the moment a file's original is smaller than the number
 * asked for. Asking for the original and refusing to enlarge it (see
 * ICON_SIZE's resize in both scrapers) can't be wrong for any file.
 */
export function preferFullSize(url: string): string {
  // Only MediaWiki's own thumb layout. Fandom uses a different scheme
  // (`/scale-to-width-down/…`) and is not the live source; leaving it
  // alone keeps this to a change that can be reasoned about.
  const match = /^(.*)\/images\/thumb\/(.+?)\/\d+px-[^/?]+(\?.*)?$/.exec(url);
  if (!match) return url;
  const [, host, file, query = ""] = match;
  return `${host}/images/${file}${query}`;
}
