// What a first-time visitor downloads before they see anything.
//
// CI already checks that the site is correct. Nothing checked that it is
// small, and nothing would have: the Firebase SDK sat in the first-paint
// bundle for months at 47.9KB gzipped, for a feature the README says most
// visitors never touch. It was found by measuring out/ by hand, once,
// because somebody happened to wonder.
//
// So this measures the same thing on every run, prints it whether it passes
// or not — a number that only appears on failure is a number nobody watches
// trending — and fails when it grows past the budget.
//
// Gzipped, not raw: GitHub Pages serves compressed, so the raw size is not
// what anyone waits for. Counted from index.html rather than from the whole
// of out/, because the point is what blocks the first paint, not what the
// export happens to contain — the lazily-imported chunks (Firebase, the
// descriptions, html2canvas) are exactly the ones that should not count.
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "..", "out");

/**
 * The ceiling, in KB gzipped.
 *
 * Measured at 378.0KB on 28 September 2026, straight after the Firebase SDK
 * was moved out of the first paint (it was 422.1KB the day before).
 *
 * The margin is small on purpose. A generous budget is one nobody ever hits,
 * which makes it decoration — this one should be close enough that adding a
 * dependency to the board is a decision rather than an accident.
 *
 * This number is meant to go DOWN. Lowering it after a real improvement is
 * how the improvement gets kept; raising it should mean a deliberate "yes,
 * this feature is worth 20KB to everyone who opens the site", written in the
 * commit message. If you are raising it because the build went over, that is
 * the check doing its job, not a number that needs adjusting.
 */
const BUDGET_KB = 390;

/** How much of a single chunk's growth is worth naming in the failure. A
 *  build that grew by 30KB across twelve chunks is a different problem from
 *  one chunk gaining 30KB, and the message should say which. */
const NOTABLE_GROWTH_KB = 1;

interface Chunk {
  path: string;
  kb: number;
}

function measure(): Chunk[] {
  const html = readFileSync(join(OUT, "index.html"), "utf8");
  // Deduplicated: a chunk referenced by both a <script> and a preload link
  // is still downloaded once.
  const referenced = [...new Set(html.match(/chunks\/[a-zA-Z0-9_-]+\.js/g) ?? [])];
  if (referenced.length === 0) {
    throw new Error(
      "No chunks found in out/index.html — run `npm run build` first, or the export's shape has changed.",
    );
  }
  return referenced
    .map((path) => ({
      path,
      kb: gzipSync(readFileSync(join(OUT, "_next", "static", path))).length / 1024,
    }))
    .sort((a, b) => b.kb - a.kb);
}

/** The previous run's sizes, if CI kept them. Absent locally and on a first
 *  run, which is why every message below reads sensibly without it. */
function previous(): Map<string, number> {
  try {
    const raw = readFileSync(join(__dirname, "..", ".bundle-size.json"), "utf8");
    const parsed = JSON.parse(raw) as Record<string, number>;
    return new Map(Object.entries(parsed));
  } catch {
    return new Map();
  }
}

const chunks = measure();
const total = chunks.reduce((sum, c) => sum + c.kb, 0);
const before = previous();

console.log(`First-paint JavaScript, gzipped — ${chunks.length} chunks\n`);
for (const chunk of chunks) {
  const was = before.get(chunk.path);
  const delta = was === undefined ? "" : `  (${chunk.kb >= was ? "+" : ""}${(chunk.kb - was).toFixed(1)})`;
  console.log(`  ${chunk.kb.toFixed(1).padStart(7)} KB  ${chunk.path}${delta}`);
}
console.log(`\n  ${total.toFixed(1).padStart(7)} KB  total, against a budget of ${BUDGET_KB} KB`);

if (total <= BUDGET_KB) {
  const headroom = BUDGET_KB - total;
  console.log(`  ${headroom.toFixed(1).padStart(7)} KB  headroom\n`);
  process.exit(0);
}

console.error(`\n::error::First-paint bundle is ${total.toFixed(1)}KB gzipped, over the ${BUDGET_KB}KB budget.`);

const grew = chunks
  .map((c) => ({ ...c, growth: c.kb - (before.get(c.path) ?? 0) }))
  .filter((c) => before.has(c.path) && c.growth >= NOTABLE_GROWTH_KB)
  .sort((a, b) => b.growth - a.growth);

if (grew.length > 0) {
  console.error("\nGrew most since the last measurement:");
  for (const c of grew.slice(0, 5)) {
    console.error(`  +${c.growth.toFixed(1)} KB  ${c.path}`);
  }
} else {
  // No baseline to compare against — name the biggest chunks instead, which
  // is where anyone looking would start anyway.
  console.error("\nLargest chunks:");
  for (const c of chunks.slice(0, 5)) {
    console.error(`  ${c.kb.toFixed(1)} KB  ${c.path}`);
  }
}

console.error(
  "\nIf this growth is intended, raise BUDGET_KB in scripts/check-bundle-size.ts" +
    " and say in the commit message what everyone is now downloading.\n",
);
process.exit(1);
