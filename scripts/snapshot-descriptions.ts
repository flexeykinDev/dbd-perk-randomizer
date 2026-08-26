// Dumps every rendered description, in both languages, to one file.
//
//   npx tsx scripts/snapshot-descriptions.ts before.txt
//   ...refactor...
//   npx tsx scripts/snapshot-descriptions.ts after.txt
//   diff before.txt after.txt
//
// The override files this exists to guard are read in two different places
// with two different meanings — a perk's curated RU `core` is a list of
// bullets that coreSummary still ranks and joins, while a loadout piece's
// core override is one line returned verbatim — and the shapes, the key
// formats and the precedence rules all differ between them. That is exactly
// the kind of thing a refactor silently changes for a handful of entries out
// of thirteen hundred.
//
// So: no reasoning about whether the merge is equivalent. Snapshot it,
// change it, and require the diff to be empty.
import { writeFileSync } from "node:fs";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { coreSummary, getPerkDescription, getLoadoutPieceDescription } from "../lib/perk-description";
import type { Lang } from "../lib/i18n";
import type { LoadoutKind } from "../lib/types";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = join(ROOT, "data");
const read = <T>(f: string): T => JSON.parse(readFileSync(join(DATA, f), "utf8")) as T;

type Row = { slug: string; name: { en: string; ru: string } };
type LoadoutRow = Row & { kind: LoadoutKind };
/* The prose files carry exactly the description fields the describe functions
 * read. Typed as that rather than as a bag of unknowns, so composing a row
 * with its prose still has to satisfy the identity contract — this script
 * used to pass `as never`, which is the same cast that let the override
 * lookup be handed identity-less objects for weeks. */
type Prose = Record<string, { description: string; descriptionRuRaw?: string }>;

function main(): void {
  const out = process.argv[2];
  if (!out) {
    console.error("Usage: npx tsx scripts/snapshot-descriptions.ts <file>");
    process.exitCode = 1;
    return;
  }

  const perkProse = read<Prose>("perk-descriptions.json");
  const loadoutProse = read<Prose>("loadout-descriptions.json");
  const perks = read<Row[]>("perks.json");
  const pieces = [
    ...read<LoadoutRow[]>("items.json"),
    ...read<LoadoutRow[]>("addons.json"),
    ...read<LoadoutRow[]>("offerings.json"),
  ];

  const lines: string[] = [];
  const record = (id: string, lang: Lang, view: ReturnType<typeof getPerkDescription>) => {
    lines.push(`${id}\t${lang}\tcore\t${coreSummary(view) ?? ""}`);
    lines.push(`${id}\t${lang}\tbullets\t${JSON.stringify(view.core)}`);
    lines.push(`${id}\t${lang}\tfull\t${view.full}`);
    lines.push(`${id}\t${lang}\tquote\t${view.quote ?? ""}`);
    lines.push(`${id}\t${lang}\tcurated\t${view.curated}`);
  };

  for (const perk of perks) {
    for (const lang of ["en", "ru"] as const) {
      record(`perk:${perk.slug}`, lang, getPerkDescription({ ...perk, ...perkProse[perk.slug] }, lang));
    }
    lines.push(`perk:${perk.slug}\tname\t${perk.name.en}\t${perk.name.ru}`);
  }
  for (const piece of pieces) {
    const key = `${piece.kind}:${piece.slug}`;
    for (const lang of ["en", "ru"] as const) {
      record(key, lang, getLoadoutPieceDescription({ ...piece, ...loadoutProse[key] }, lang));
    }
    lines.push(`${key}\tname\t${piece.name.en}\t${piece.name.ru}`);
  }

  writeFileSync(out, lines.join("\n") + "\n");
  console.log(`${lines.length} lines covering ${perks.length} perks and ${pieces.length} loadout pieces -> ${out}`);
}

main();
