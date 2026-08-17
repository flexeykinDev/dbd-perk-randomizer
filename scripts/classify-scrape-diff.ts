// Decides whether the scheduled scraper's PR (see .github/workflows/
// update-perks.yml) is safe to auto-merge without a human looking at it.
//
// Philosophy: brand-new entries (a DLC's new perks/items/icons) can't
// regress anything that already worked, so they're safe. Anything that
// changes or removes an EXISTING entry's data is exactly the class of bug
// that slipped through before this script existed — the scraper silently
// reverted "Deja Vu"'s name and the Hex: Fortune's Fool icon back to the
// wiki's own (wrong) data on every run, because nothing was watching for a
// pre-existing perk's fields changing out from under it. That always needs
// a human's eyes now, even if the change is legitimate (a wiki correction,
// a genuine rework) — the point isn't "changes are bad," it's "an
// unattended bot is the wrong judge of whether this particular change is
// wanted."
//
// Run after the scrape:* scripts, while their output sits uncommitted in
// the working tree — diffs each tracked data file's working-tree content
// against its last-committed (HEAD) content, and checks which icon files
// under public/ are new vs modified via `git status`.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

interface Finding {
  safe: boolean;
  detail: string;
}

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" });
}

function readHeadJson(relPath: string): unknown {
  try {
    return JSON.parse(git(["show", `HEAD:${relPath}`]));
  } catch {
    // File didn't exist at HEAD (e.g. a genuinely new data file) — treat
    // as "everything in it is new" by comparing against an empty shape.
    return null;
  }
}

function readWorkingJson(relPath: string): unknown {
  const abs = join(ROOT, relPath);
  if (!existsSync(abs)) return null;
  return JSON.parse(readFileSync(abs, "utf8"));
}

/** Deep-equal ignoring `addedAt`, which is expected to be carried forward
 *  unchanged for existing entries and is irrelevant to what actually
 *  changed. */
function entriesEqual(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const strip = (o: Record<string, unknown>) => {
    const copy = { ...o };
    delete copy.addedAt;
    return copy;
  };
  return JSON.stringify(strip(a)) === JSON.stringify(strip(b));
}

/** Array-of-objects data files (perks/items/addons/offerings), each entry
 *  uniquely keyed by a field (or combination) that's stable across runs. */
function classifyEntryList(
  label: string,
  relPath: string,
  keyOf: (entry: Record<string, unknown>) => string,
): Finding[] {
  const before = (readHeadJson(relPath) as Record<string, unknown>[] | null) ?? [];
  const after = (readWorkingJson(relPath) as Record<string, unknown>[] | null) ?? [];
  const beforeByKey = new Map(before.map((e) => [keyOf(e), e]));
  const afterByKey = new Map(after.map((e) => [keyOf(e), e]));
  const findings: Finding[] = [];

  for (const [key, entry] of afterByKey) {
    const prev = beforeByKey.get(key);
    if (!prev) {
      findings.push({ safe: true, detail: `${label}: new entry "${key}"` });
    } else if (!entriesEqual(prev, entry)) {
      findings.push({ safe: false, detail: `${label}: existing entry "${key}" changed` });
    }
  }
  for (const key of beforeByKey.keys()) {
    if (!afterByKey.has(key)) {
      findings.push({ safe: false, detail: `${label}: entry "${key}" disappeared from the wiki` });
    }
  }
  return findings;
}

/** Flat string->string or string->number maps (killer-power-icons.json,
 *  characters.json, perk-ids.json, loadout-ids.json). An existing key's
 *  value changing is always unsafe — for the two ID files in particular,
 *  it would silently break every previously-shared build/seed link. */
function classifyFlatMap(label: string, relPath: string): Finding[] {
  const before = (readHeadJson(relPath) as Record<string, unknown> | null) ?? {};
  const after = (readWorkingJson(relPath) as Record<string, unknown> | null) ?? {};
  const findings: Finding[] = [];

  for (const [key, value] of Object.entries(after)) {
    if (!(key in before)) {
      findings.push({ safe: true, detail: `${label}: new key "${key}"` });
    } else if (before[key] !== value) {
      findings.push({
        safe: false,
        detail: `${label}: "${key}" changed (${JSON.stringify(before[key])} -> ${JSON.stringify(value)})`,
      });
    }
  }
  for (const key of Object.keys(before)) {
    if (!(key in after)) {
      findings.push({ safe: false, detail: `${label}: key "${key}" was removed` });
    }
  }
  return findings;
}

/** Icon/portrait binary files under public/ — `git status` alone tells us
 *  new (safe) vs modified (unsafe) without needing to compare bytes. */
function classifyPublicAssets(): Finding[] {
  const prefixes = ["public/perks/", "public/characters/", "public/loadout/"];
  const status = git(["status", "--porcelain", "--", ...prefixes]);
  const findings: Finding[] = [];
  for (const line of status.split("\n")) {
    if (!line.trim()) continue;
    const code = line.slice(0, 2);
    const path = line.slice(3).trim();
    if (code.includes("M")) {
      findings.push({ safe: false, detail: `Icon file changed: ${path}` });
    }
    // "A", "??" (untracked), or renames are all a brand-new file — safe.
  }
  return findings;
}

function main() {
  const findings: Finding[] = [
    ...classifyEntryList("Perk", "data/perks.json", (p) => `${p.role}/${p.slug}`),
    ...classifyEntryList("Item", "data/items.json", (p) => String(p.slug)),
    ...classifyEntryList("Add-on", "data/addons.json", (p) => String(p.slug)),
    ...classifyEntryList("Offering", "data/offerings.json", (p) => String(p.slug)),
    ...classifyFlatMap("Killer power icon", "data/killer-power-icons.json"),
    ...classifyFlatMap("Character portrait", "data/characters.json"),
    ...classifyFlatMap("Perk ID", "data/perk-ids.json"),
    ...classifyFlatMap("Loadout ID", "data/loadout-ids.json"),
    ...classifyPublicAssets(),
  ];

  const unsafe = findings.filter((f) => !f.safe);
  const safeAdditions = findings.filter((f) => f.safe);
  const isSafe = unsafe.length === 0;

  const lines: string[] = [];
  if (findings.length === 0) {
    lines.push("No content changes — only the scrape timestamps moved.");
  } else {
    if (safeAdditions.length > 0) {
      lines.push(`**${safeAdditions.length} new entr${safeAdditions.length === 1 ? "y" : "ies"}** (auto-merge-safe):`);
      for (const f of safeAdditions) lines.push(`- ${f.detail}`);
    }
    if (unsafe.length > 0) {
      lines.push("");
      lines.push(`**${unsafe.length} change${unsafe.length === 1 ? "" : "s"} to existing data** — needs a human look:`);
      for (const f of unsafe) lines.push(`- ${f.detail}`);
    }
  }

  const summary = lines.join("\n");
  console.log(`Safe to auto-merge: ${isSafe}\n\n${summary}`);

  const summaryPath = join(ROOT, "scrape-diff-summary.md");
  writeFileSync(summaryPath, summary);

  const githubOutput = process.env.GITHUB_OUTPUT;
  if (githubOutput) {
    appendFileSync(githubOutput, `safe=${isSafe}\n`);
  }
}

main();
