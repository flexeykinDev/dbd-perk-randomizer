// Removes icon files nothing points at any more, and the download-cache
// entries that went with them.
//
// They accumulate from renames. The wiki has renamed eight perks so far
// (decisive-strike -> will-to-live and friends), plus a handful of items and
// offerings; each rename writes a new icon and leaves the old one on disk
// forever. Retired slugs deliberately live on in perk-slug-aliases.json and
// the id maps so old share links keep working, but those resolve to the
// *current* perk and its current icon — nothing ever asks for the old file.
//
// Dry run by default, like scripts/prune-obs-rooms.ts: deleting files is not
// something a script should do because you ran it.
//
//   npx tsx scripts/prune-orphan-icons.ts            # report only
//   npx tsx scripts/prune-orphan-icons.ts --delete   # actually remove
import { readFileSync, writeFileSync, readdirSync, statSync, unlinkSync, existsSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = join(ROOT, "public");
const read = <T>(file: string): T => JSON.parse(readFileSync(join(ROOT, "data", file), "utf8")) as T;

interface WithIcon {
  icon: string;
}

/** Every icon path the shipped data actually points at. */
function referenced(): Set<string> {
  const perks = read<WithIcon[]>("perks.json");
  const items = read<WithIcon[]>("items.json");
  const addons = read<WithIcon[]>("addons.json");
  const offerings = read<WithIcon[]>("offerings.json");
  const characters = read<Record<string, string>>("characters.json");
  const powers = read<Record<string, string>>("killer-power-icons.json");
  return new Set([
    ...[...perks, ...items, ...addons, ...offerings].map((x) => x.icon),
    ...Object.values(characters),
    ...Object.values(powers),
  ]);
}

/** Every .webp under public/, as a site-absolute path. */
function onDisk(dir: string, prefix: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(PUBLIC, dir), { withFileTypes: true })) {
    const rel = posix.join(prefix, entry.name);
    if (entry.isDirectory()) out.push(...onDisk(join(dir, entry.name), rel));
    else if (entry.name.endsWith(".webp")) out.push(rel);
  }
  return out;
}

/** Where a download-cache key would have put its file, so a key pointing at
 *  a file we no longer have can be recognised as dead.
 *  "perk:survivor/adrenaline" -> "/perks/survivor/adrenaline.webp"
 *  "item/flashlight"          -> "/loadout/item/flashlight.webp" */
function destinationFor(key: string): string | null {
  const perk = /^perk:(survivor|killer)\/(.+)$/.exec(key);
  if (perk) return `/perks/${perk[1]}/${perk[2]}.webp`;
  const loadout = /^(item|addon|offering|power)\/(.+)$/.exec(key);
  if (loadout) return `/loadout/${loadout[1]}/${loadout[2]}.webp`;
  return null;
}

function pruneCache(file: string, gone: Set<string>, apply: boolean): number {
  const path = join(ROOT, "data", file);
  const cache = JSON.parse(readFileSync(path, "utf8")) as Record<string, string>;
  const dead = Object.keys(cache).filter((key) => {
    const dest = destinationFor(key);
    // Unrecognised keys are left alone: not understanding a key is not the
    // same as knowing it is dead.
    if (!dest) return false;
    return gone.has(dest) || !existsSync(join(PUBLIC, dest));
  });
  if (apply && dead.length > 0) {
    for (const key of dead) delete cache[key];
    writeFileSync(path, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
  }
  return dead.length;
}

function main(): void {
  const apply = process.argv.includes("--delete");
  const refs = referenced();
  const files = [
    ...onDisk("perks", "/perks"),
    ...onDisk("loadout", "/loadout"),
    ...onDisk("characters", "/characters"),
  ];
  const orphans = files.filter((f) => !refs.has(f));

  let bytes = 0;
  for (const orphan of orphans) bytes += statSync(join(PUBLIC, orphan)).size;

  console.log(`${files.length} icons on disk, ${refs.size} referenced by data.`);
  if (orphans.length === 0) {
    console.log("No orphans.");
    return;
  }
  console.log(`${orphans.length} orphaned (${(bytes / 1024).toFixed(0)} KB):`);
  for (const orphan of orphans) console.log(`  ${orphan}`);

  const gone = new Set(orphans);
  if (!apply) {
    const dead =
      pruneCache("icon-sources.json", gone, false) +
      pruneCache("loadout-icon-sources.json", gone, false);
    console.log(`\nWould also drop ${dead} dead download-cache entries.`);
    console.log("Dry run. Pass --delete to apply.");
    return;
  }

  for (const orphan of orphans) unlinkSync(join(PUBLIC, orphan));
  const dead =
    pruneCache("icon-sources.json", gone, true) +
    pruneCache("loadout-icon-sources.json", gone, true);
  console.log(`\nDeleted ${orphans.length} files and ${dead} cache entries.`);
}

main();
