// Does everything the site points at actually exist?
//
// A wrong icon path is the quietest possible data bug: nothing throws, the
// build succeeds, CI is green, and the visitor gets a broken-image glyph
// where a perk should be. That has already happened once in this repo. The
// other guards check ids (id-stability), release dates (release-gate),
// category counts (scrape-census) and the loadout's internal consistency
// (lib/loadout.test.ts) — none of them opens public/ to see whether the
// files are there.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Perk } from "../lib/types.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = <T>(file: string): T => JSON.parse(readFileSync(join(ROOT, "data", file), "utf8")) as T;

interface LoadoutPiece {
  kind: string;
  slug: string;
  icon: string;
}

const perks = read<Perk[]>("perks.json");
const characters = read<Record<string, string>>("characters.json");
const powerIcons = read<Record<string, string>>("killer-power-icons.json");
const loadout = [
  ...read<LoadoutPiece[]>("items.json"),
  ...read<LoadoutPiece[]>("addons.json"),
  ...read<LoadoutPiece[]>("offerings.json"),
];

/** Every icon the shipped data points at, with something to blame. */
function everyReference(): Array<{ path: string; owner: string }> {
  return [
    ...perks.map((p) => ({ path: p.icon, owner: `perk ${p.slug}` })),
    ...loadout.map((l) => ({ path: l.icon, owner: `${l.kind} ${l.slug}` })),
    ...Object.entries(characters).map(([name, icon]) => ({ path: icon, owner: `character ${name}` })),
    ...Object.entries(powerIcons).map(([name, icon]) => ({ path: icon, owner: `power ${name}` })),
  ];
}

test("every icon the data points at is a real, non-empty file", () => {
  const broken: string[] = [];
  for (const { path, owner } of everyReference()) {
    // Paths are site-absolute ("/perks/killer/x.webp") and served from
    // public/, which is what basePath-aware code resolves them against.
    const file = join(ROOT, "public", path);
    let size: number;
    try {
      const stat = statSync(file);
      if (!stat.isFile()) {
        broken.push(`${owner}: ${path} is not a file`);
        continue;
      }
      size = stat.size;
    } catch {
      broken.push(`${owner}: ${path} is missing`);
      continue;
    }
    if (size === 0) broken.push(`${owner}: ${path} is empty`);
  }
  assert.deepEqual(broken, [], `${broken.length} broken icon references`);
});

test("icon paths are site-absolute, so a basePath deploy resolves them", () => {
  // A relative path works on the root domain and breaks the moment the site
  // is served from a repo subpath (see NEXT_BASE_PATH in next.config.ts).
  const wrong = everyReference()
    .filter(({ path }) => !path.startsWith("/"))
    .map(({ path, owner }) => `${owner}: ${path}`);
  assert.deepEqual(wrong, []);
});

test("no two perks share a slug", () => {
  // Slugs are the share-link vocabulary and the pool-exclusion key; two
  // perks answering to one slug means excluding one silently excludes both.
  const seen = new Map<string, number>();
  for (const perk of perks) seen.set(perk.slug, (seen.get(perk.slug) ?? 0) + 1);
  const dupes = [...seen].filter(([, n]) => n > 1).map(([slug, n]) => `${slug} ×${n}`);
  assert.deepEqual(dupes, []);
});

test("no two loadout pieces share a kind and slug", () => {
  const seen = new Map<string, number>();
  for (const piece of loadout) {
    const key = `${piece.kind}:${piece.slug}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  const dupes = [...seen].filter(([, n]) => n > 1).map(([key, n]) => `${key} ×${n}`);
  assert.deepEqual(dupes, []);
});

test("every perk has a description to show when its card is opened", () => {
  const descriptions = read<Record<string, { description?: string }>>("perk-descriptions.json");
  const missing = perks
    .filter((p) => !(descriptions[p.slug]?.description ?? "").trim())
    .map((p) => p.slug);
  assert.deepEqual(missing, []);
});

test("no description leaks the markup it was scraped out of", () => {
  // The parser strips wiki templates and HTML; when a page changes shape it
  // stops stripping and the raw markup goes straight to the card.
  const descriptions = read<Record<string, { description?: string }>>("perk-descriptions.json");
  const leaked = Object.entries(descriptions)
    .filter(([, v]) => /<\/?(div|table|span|img|a\s)|\{\{|\}\}|\[\[/i.test(v.description ?? ""))
    .map(([slug]) => slug);
  assert.deepEqual(leaked, []);
});

test("every curated preset is built from perks that still exist", () => {
  // Presets are hand-written, so a perk renamed on the wiki silently turns
  // one of them into a build with a hole in it.
  const presets = read<{ presets?: Array<{ id?: string; perks?: string[] }> }>("build-presets.json");
  const slugs = new Set(perks.map((p) => p.slug));
  const broken: string[] = [];
  for (const preset of presets.presets ?? [])
    for (const slug of preset.perks ?? [])
      if (!slugs.has(slug)) broken.push(`${preset.id ?? "preset"} → ${slug}`);
  assert.deepEqual(broken, []);
});
