// BHVR's own numbers, so the wiki can be checked against them.
//
// The scrapers trust deadbydaylight.wiki.gg completely, and almost always that
// is right. It is wrong in one specific way, found on 6 October 2026 while
// checking 10.2.0: the wiki documents the PTB build, and when BHVR changes a
// value between the PTB and the live release, the wiki is not always corrected.
// The scrape then copies a number that never shipped, every guard passes —
// nothing was lost, no id moved, the count is identical — and the site states a
// cooldown the game does not have.
//
// Three perks proved it at once. BHVR's "PTB to Live Changes" post names the
// values it replaced, and those were exactly what the site was showing:
//
//     Premonition             site 70/65/60s   PTB 70/65/60   live 55/50/45
//     Hex: Thrill of the Hunt site 6/7/8s      PTB 6/7/8      live 4/5/6
//     Bitter Murmur           site 10/12/14s   PTB 10/12/14   live 16/18/20
//
// So this reads the patch notes themselves, from Steam's news API — official,
// structured, and the same document a player would read. It does not write
// anything. It reports where the shipped data and BHVR disagree, and a person
// decides, because the one habit that caused this was trusting a single source
// without ever asking it to agree with another.
//
// Everything here is pure except `fetchPatchNotes`, so the parsing is testable
// without a network.

/** One perk as the patch notes describe it. */
export interface NotedPerk {
  /** English name, as printed. */
  name: string;
  /** Tier triples the notes state, normalised to "a/b/c". */
  values: string[];
  /** True when the notes mark it "(Rework)", which usually means the prose
   *  changed shape and not merely a number. */
  rework: boolean;
}

/** Steam's patch notes are BBCode. Only the text matters here. */
export function stripBBCode(input: string): string {
  return input
    .replace(/\[\/?[a-z*][^\]]*\]/gi, " ")
    .replace(/&nbsp;| /g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** "150%/175%/200%" and "55 / 50 / 45" both become "150/175/200" / "55/50/45".
 *
 *  Values are written inconsistently in the notes — a stray percent inside the
 *  triple, spaces around the slashes, a bold tag splitting the last number off.
 *  Comparing normalised forms is what makes the two sources comparable at all. */
export function tierValues(text: string): string[] {
  const out: string[] = [];
  /* Three things this pattern has to tolerate, each found in real text rather
     than imagined:
       -  a sign, because the wiki writes penalties as "-6/-7/-8 %"
       -  a stray percent inside the triple, as in "150%/175%/200%"
       -  spaces around the slashes
     Written with a RegExp literal, not built from a template string: `\s` in an
     untagged template collapses to a bare "s", so the first version of this
     silently matched the letter s where it meant whitespace and only worked
     because the common case has no spaces at all. */
  const pattern = /(-?\d+(?:\.\d+)?)\s*%?\s*\/\s*(-?\d+(?:\.\d+)?)\s*%?\s*\/\s*(-?\d+(?:\.\d+)?)/g;
  for (const m of text.matchAll(pattern)) {
    /* The sign is presentation, not value: the notes say "repair 6/7/8% slower"
       where the wiki says "-6/-7/-8 % slower", and those are the same perk doing
       the same thing. Comparing them as written reported a disagreement that did
       not exist. */
    const parts = [m[1], m[2], m[3]].map((p) => p.replace(/^-/, ""));
    /* Dates look exactly like tier triples. "12/02/1943" is the date on a quote
       in Undone's flavour text and was being reported as a value the perk does
       not have. No perk tier reaches four digits — 200 is the largest there is —
       so the year gives it away. */
    if (parts.some((p) => p.split(".")[0].length >= 4)) continue;
    out.push(parts.join("/"));
  }
  return [...new Set(out)];
}

/* A perk heading looks like `[*][p][b]Premonition [/b][i](Rework)[/i]`, and its
   bullets run until the next one. Splitting on the bold headings is enough; the
   notes are generated from one template and have been stable across releases. */
const HEADING = /\[\*\]\s*\[p\]\s*\[b\]\s*([^[\]]{3,60}?)\s*\[\/b\]/gi;

/** Every perk the notes mention, with the values stated for it. */
export function parsePatchNotes(contents: string): NotedPerk[] {
  const headings = [...contents.matchAll(HEADING)];
  const perks: NotedPerk[] = [];

  for (let i = 0; i < headings.length; i++) {
    const name = headings[i][1].replace(/\s+/g, " ").trim();
    // Headings are also used for section titles ("Survivor Perks", "Bug Fixes").
    // A perk's block contains values; a section title's does not, so the filter
    // below removes them without needing a list of section names to maintain.
    const start = headings[i].index! + headings[i][0].length;
    const end = i + 1 < headings.length ? headings[i + 1].index! : contents.length;
    const body = contents.slice(start, end);

    /* "(was 36m and within 45 degrees)" states the OLD value. Including it
       would make the check pass against data that still holds the old number,
       which is the entire thing being looked for. */
    const withoutWas = body.replace(/\[i\][^[]*\(was[^)]*\)[^[]*\[\/i\]/gi, " ");
    const values = tierValues(stripBBCode(withoutWas));
    if (values.length === 0) continue;

    perks.push({
      name,
      values,
      rework: /\[i\]\s*\(rework\)/i.test(body.slice(0, 120)),
    });
  }
  return perks;
}

interface SteamNewsItem {
  title: string;
  contents: string;
  date: number;
  url: string;
}

/** The newest LIVE patch notes for an app.
 *
 *  PTB notes are excluded by title, and that exclusion is the point of this
 *  function rather than a detail of it: the PTB document sits in the same feed,
 *  is the same length, and describes the same release, so anything reading
 *  "the 10.2.0 notes" without discriminating has a 50% chance of checking the
 *  shipped data against numbers that were explicitly replaced before launch. */
export async function fetchPatchNotes(
  appId = 381210,
  count = 20,
): Promise<{ title: string; url: string; date: Date; perks: NotedPerk[] } | null> {
  const api =
    `https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/` +
    `?appid=${appId}&count=${count}&maxlength=0&format=json`;
  const response = await fetch(api);
  if (!response.ok) throw new Error(`Steam news API returned ${response.status}`);
  const body = (await response.json()) as { appnews?: { newsitems?: SteamNewsItem[] } };
  const items = body.appnews?.newsitems ?? [];

  const live = items
    .filter((i) => /patch notes|mid-chapter|chapter/i.test(i.title))
    .filter((i) => !/\bPTB\b/i.test(i.title))
    .sort((a, b) => b.date - a.date);

  for (const item of live) {
    const perks = parsePatchNotes(item.contents);
    // A release with no perk changes is ordinary; keep looking for one that has
    // some rather than reporting "nothing to check" on a bug-fix patch.
    if (perks.length > 0) {
      return { title: item.title, url: item.url, date: new Date(item.date * 1000), perks };
    }
  }
  return null;
}

/** A perk whose shipped description states none of the values the notes do. */
export interface Disagreement {
  perk: string;
  slug: string;
  expected: string[];
  found: string[];
  rework: boolean;
}

/** Compares the notes against shipped descriptions.
 *
 *  `shipped` maps an English perk name to its description text. A perk in the
 *  notes that this repo does not ship is skipped rather than reported — the
 *  notes cover content the data may not have yet, and that is the release
 *  gate's business, not this one's. */
export function disagreements(
  noted: readonly NotedPerk[],
  shipped: ReadonlyMap<string, { slug: string; description: string }>,
): Disagreement[] {
  /* Keyed by slug, because the notes list most perks TWICE — once under
     "Survivor Perks"/"Killer Perks" and again in the section explaining why
     they changed. Reporting each occurrence separately said "17 perks
     disagree" where nine do, which overstates the problem and makes the list
     tedious to work through. The values from both mentions are merged: either
     one matching is agreement. */
  const bySlug = new Map<string, Disagreement>();
  const agreed = new Set<string>();

  for (const perk of noted) {
    const entry = lookup(shipped, perk.name);
    if (!entry) continue;
    const found = tierValues(entry.description);
    if (perk.values.some((v) => found.includes(v))) {
      agreed.add(entry.slug);
      continue;
    }
    const existing = bySlug.get(entry.slug);
    if (existing) {
      existing.expected = [...new Set([...existing.expected, ...perk.values])];
      existing.rework = existing.rework || perk.rework;
    } else {
      bySlug.set(entry.slug, {
        perk: perk.name,
        slug: entry.slug,
        expected: [...perk.values],
        found,
        rework: perk.rework,
      });
    }
  }

  // A perk mentioned twice where only one mention matched is not a problem.
  for (const slug of agreed) bySlug.delete(slug);
  return [...bySlug.values()];
}

/** Name matching, with the one spelling difference that actually occurs.
 *
 *  BHVR writes "Hex: Blood Favor" in the notes and "Hex: Blood Favour" in the
 *  game; the wiki follows the game. Rather than a synonym list that rots, both
 *  sides are reduced to a form where the -our/-or pair collapses. */
function lookup<T>(map: ReadonlyMap<string, T>, name: string): T | undefined {
  const direct = map.get(name.toLowerCase());
  if (direct) return direct;
  const key = fold(name);
  for (const [candidate, value] of map) if (fold(candidate) === key) return value;
  return undefined;
}

export function fold(name: string): string {
  return name
    .toLowerCase()
    .replace(/our\b/g, "or")
    .replace(/[^a-z0-9]/g, "");
}
