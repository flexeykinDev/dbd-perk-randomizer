// Downloads the two role icons — the Survivor and Killer emblems the game
// uses on its own loading screens — into public/roles/.
//
//   npx tsx scripts/scrape-role-icons.ts
//
// Same source and the same shape as every other icon on the site (see
// scripts/scrape-perks.ts): resolved through the MediaWiki API rather than by
// scraping a page, because the wiki's article URLs sit behind a Cloudflare JS
// challenge that a plain fetch cannot pass while api.php does not.
//
// Two files, changing about never, so this is a one-off rather than part of
// the weekly refresh — but it is a script instead of a manual download so the
// provenance of the bytes in the repo is written down.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "public", "roles");
const API = "https://deadbydaylight.wiki.gg/api.php";

/** Drawn at ~40px on a card back; 128 is plenty and keeps the files tiny. */
const SIZE = 128;

const FILES: Record<string, string> = {
  survivor: "File:IconHelpLoading_survivor.png",
  killer: "File:IconHelpLoading_killer.png",
};

async function resolveUrl(title: string): Promise<string> {
  const url = `${API}?action=query&format=json&prop=imageinfo&iiprop=url&titles=${encodeURIComponent(title)}`;
  const res = await fetch(url, { headers: { "user-agent": "dbd-perk-randomizer/scrape-role-icons" } });
  if (!res.ok) throw new Error(`${title}: API returned ${res.status}`);
  const body = (await res.json()) as {
    query?: { pages?: Record<string, { missing?: string; imageinfo?: { url: string }[] }> };
  };
  const page = Object.values(body.query?.pages ?? {})[0];
  const direct = page?.imageinfo?.[0]?.url;
  if (!direct) throw new Error(`${title}: no image URL (missing from the wiki?)`);
  return direct;
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  for (const [role, title] of Object.entries(FILES)) {
    const url = await resolveUrl(title);
    const res = await fetch(url, { headers: { "user-agent": "dbd-perk-randomizer/scrape-role-icons" } });
    if (!res.ok) throw new Error(`${role}: download returned ${res.status}`);
    const source = Buffer.from(await res.arrayBuffer());
    // Kept as PNG with its alpha: the icon is drawn onto a dark card and a
    // matted background would show as a square.
    const out = await sharp(source)
      .resize(SIZE, SIZE, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
    const path = join(OUT_DIR, `${role}.png`);
    writeFileSync(path, out);
    console.log(`${role}: ${(out.length / 1024).toFixed(1)} KB  <- ${url}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
