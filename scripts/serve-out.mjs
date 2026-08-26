// Serves the static export in out/ — the exact artifact that deploys to
// GitHub Pages — for the e2e suite.
//
// The suite used to run against `next dev`, which is a different program
// producing a different bundle, and which compiles a route the first time
// it is asked for. Testing the thing that ships is both more honest and,
// measured, faster: a full run went from ~52s to ~43s.
//
// No dependency. A static export is a directory of files, and Node can
// already serve a directory of files.
import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../out", import.meta.url));
// Deliberately not 3000: that is where `npm run dev` lives, and Playwright's
// reuseExistingServer would happily run the whole suite against a dev server
// someone left open — silently undoing the point of this file.
const PORT = Number(process.env.PORT ?? 3100);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};

async function resolveFile(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  // normalize() collapses any "..", and the prefix check refuses anything
  // that still points outside the export.
  const base = join(ROOT, normalize(decoded).replace(/^[/\\]+/, ""));
  if (base !== ROOT && !base.startsWith(ROOT + sep)) return null;

  // A static export writes /obs as either obs.html or obs/index.html
  // depending on trailingSlash, so try the plain file and then both shapes.
  for (const candidate of [base, `${base}.html`, join(base, "index.html")]) {
    try {
      if ((await stat(candidate)).isFile()) return candidate;
    } catch {
      // Try the next shape.
    }
  }
  return null;
}

const server = createServer(async (req, res) => {
  const path = new URL(req.url ?? "/", "http://localhost").pathname;
  const file = await resolveFile(path);
  const fallback = file ?? (await resolveFile("/404"));
  if (!fallback) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }
  res.writeHead(file ? 200 : 404, {
    "content-type": TYPES[extname(fallback)] ?? "application/octet-stream",
    // Tests reload pages and must see what the server has now, not what an
    // earlier test left in the HTTP cache.
    "cache-control": "no-store",
  });
  createReadStream(fallback).pipe(res);
});

try {
  if (!(await stat(ROOT)).isDirectory()) throw new Error("not a directory");
} catch {
  console.error(`No static export at ${ROOT}. Run \`npm run build\` first.`);
  process.exit(1);
}

/* Refuse to serve an export older than the code it was built from.
 *
 * `npm run test:e2e` builds first, so the packaged path was always safe. The
 * gap was the iteration path: running `playwright test` on its own serves
 * whatever happens to be in out/, and a run against yesterday's bundle passes
 * cheerfully. That has cost real debugging time — twice in one session, once
 * while verifying a fix and once mid break-test, where a stale export made a
 * deliberately broken build look green.
 *
 * Fails loudly instead. Set E2E_ALLOW_STALE=1 to serve an old export anyway
 * (bisecting a bundle, say). */
async function newestSourceTime() {
  const SKIP = new Set(["node_modules", ".next", "out", ".git", "test-results", "playwright-report"]);
  const roots = ["app", "components", "lib", "data", "public", "next.config.ts", "package.json"]
    .map((p) => fileURLToPath(new URL(`../${p}`, import.meta.url)));
  let newest = 0;
  async function walk(path) {
    let info;
    try {
      info = await stat(path);
    } catch {
      return; // An optional path that does not exist here.
    }
    if (info.isFile()) {
      newest = Math.max(newest, info.mtimeMs);
      return;
    }
    if (!info.isDirectory()) return;
    for (const entry of await readdir(path, { withFileTypes: true })) {
      if (SKIP.has(entry.name)) continue;
      await walk(join(path, entry.name));
    }
  }
  await Promise.all(roots.map(walk));
  return newest;
}

if (process.env.E2E_ALLOW_STALE !== "1") {
  const built = (await stat(join(ROOT, "index.html")).catch(() => null))?.mtimeMs ?? 0;
  const source = await newestSourceTime();
  // A second of slack: a build reads its inputs and writes its outputs at
  // very nearly the same moment, and mtime resolution varies by filesystem.
  if (source > built + 1000) {
    const age = Math.round((source - built) / 1000);
    console.error(
      `out/ is ${age}s older than your sources — it was built from different code.\n` +
        `Run \`npm run build\` first, or set E2E_ALLOW_STALE=1 to serve it anyway.`,
    );
    process.exit(1);
  }
}

server.listen(PORT, () => {
  console.log(`Serving ${ROOT} on http://localhost:${PORT}`);
});
