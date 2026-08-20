// Resolves the footer's author name and avatar once, at build time, into
// data/author.json and public/author-avatar.webp.
//
// The footer used to do this at runtime: every page load fetched
// api.github.com for a display name and an avatar URL. That call is
// rate-limited to 60/hour per IP when unauthenticated, so on any machine
// that opens the site regularly it answers 403 and the footer falls back —
// which was, in this repo's case, to exactly the values the API would have
// returned anyway (the account has no display name set, so `name` is null
// and the code fell through to `login`). Four requests per page load, in
// the load path, to learn nothing.
//
// Run it when the profile changes; the values it writes are the ones that
// ship. It degrades rather than fails: if GitHub is unreachable or rate-
// limited, whatever is already committed stays.
import { writeFile, readFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA_FILE = join(ROOT, "data", "author.json");
const AVATAR_FILE = join(ROOT, "public", "author-avatar.webp");

const LOGIN = "flexeykinDev";
/** The footer draws it at 36px; 72 is that at 2x, which is as much as any
 *  display can show. The source is ~19 KB of JPEG at full size. */
const AVATAR_PX = 72;

interface Author {
  login: string;
  name: string;
}

async function currentAuthor(): Promise<Author | null> {
  try {
    return JSON.parse(await readFile(DATA_FILE, "utf8")) as Author;
  } catch {
    return null;
  }
}

interface Profile {
  name: string;
  avatarUrl: string | null;
}

async function fetchProfile(): Promise<Profile | null> {
  try {
    const res = await fetch(`https://api.github.com/users/${LOGIN}`);
    if (!res.ok) {
      console.warn(`  GitHub API answered ${res.status} — keeping the committed name.`);
      return null;
    }
    const data = (await res.json()) as { name?: string | null; avatar_url?: string };
    // No display name set on the account means `name` is null, and the
    // login is what the site should show.
    return { name: data.name || LOGIN, avatarUrl: data.avatar_url ?? null };
  } catch (error) {
    console.warn(`  GitHub API unreachable (${String(error)}) — keeping the committed name.`);
    return null;
  }
}

async function main(): Promise<void> {
  const existing = await currentAuthor();
  const profile = await fetchProfile();

  const name = profile?.name ?? existing?.name ?? LOGIN;

  // github.com/<login>.png redirects to the avatar and is not part of the
  // rate-limited API, so the picture is still refreshable even when the
  // profile call above is refused.
  const avatarUrl = profile?.avatarUrl ?? `https://github.com/${LOGIN}.png`;
  const res = await fetch(avatarUrl);
  if (!res.ok) throw new Error(`avatar: ${avatarUrl} answered ${res.status}`);
  const source = Buffer.from(await res.arrayBuffer());

  await mkdir(dirname(AVATAR_FILE), { recursive: true });
  await sharp(source)
    .resize(AVATAR_PX, AVATAR_PX, { fit: "cover", withoutEnlargement: true })
    .webp({ quality: 88 })
    .toFile(AVATAR_FILE);

  const author: Author = { login: LOGIN, name };
  await writeFile(DATA_FILE, `${JSON.stringify(author, null, 2)}\n`, "utf8");

  console.log(`Author: ${name} (${LOGIN})`);
  console.log(`Avatar: ${AVATAR_PX}x${AVATAR_PX} webp from ${avatarUrl}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
