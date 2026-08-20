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
import { stat } from "node:fs/promises";
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

server.listen(PORT, () => {
  console.log(`Serving ${ROOT} on http://localhost:${PORT}`);
});
