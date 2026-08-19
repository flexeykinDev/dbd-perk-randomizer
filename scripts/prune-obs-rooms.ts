// Deletes OBS overlay rooms nobody has published to in a while.
//
// Not urgent, and the numbers say so: a room is roughly 1–1.5 KB and the
// free tier stores 1 GB, so the ceiling is somewhere near 700,000 rooms.
// The limit reached first is 100 simultaneous connections, which depends
// on how many overlays are open at once and not at all on how many rooms
// exist. This is housekeeping, not a fix.
//
// It is safe housekeeping, which is the part worth knowing. A room code
// lives in the streamer's localStorage and in the URL pasted into OBS;
// deleting the *data* does not invalidate the *code*. Their Browser Source
// keeps working and the room is recreated on their next publish. The worst
// case is an overlay showing "waiting for a build" until they roll once,
// and it heals itself.
//
// No credentials: the site publishes to these rooms from the browser
// without signing in, so the database rules already allow unauthenticated
// writes to this path — the same access this uses. That is a deliberate
// property of the design (a room code is the capability), not an oversight
// this script depends on.
//
// Dry-run unless --delete is passed. Deleting from a live database is not
// something to do as a side effect of running a script to see what it
// would do.
const DB = "https://dbd-perk-randomizer-default-rtdb.europe-west1.firebasedatabase.app";
const ROOMS_PATH = "obs-rooms";

/** Two weeks rather than one. Either is safe — a pruned room comes back on
 *  the next publish — but a streamer who goes a fortnight between streams
 *  should not routinely find the overlay waiting on them. */
const DEFAULT_MAX_AGE_DAYS = 14;

interface Room {
  updatedAt?: number;
}

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.split("=")[1];
}

async function main() {
  const maxAgeDays = Number(arg("days") ?? DEFAULT_MAX_AGE_DAYS);
  if (!Number.isFinite(maxAgeDays) || maxAgeDays < 1) {
    throw new Error(`--days must be a positive number, got ${arg("days")}`);
  }
  const apply = process.argv.includes("--delete");
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;

  const res = await fetch(`${DB}/${ROOMS_PATH}.json`);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} reading ${ROOMS_PATH}`);
  const rooms: Record<string, Room> | null = await res.json();
  if (!rooms) {
    console.log("No rooms at all — nothing to do.");
    return;
  }

  const entries = Object.entries(rooms);
  const stale = entries.filter(([, room]) => {
    // A room with no timestamp predates updatedAt being written, which
    // makes it old by definition.
    const updatedAt = typeof room?.updatedAt === "number" ? room.updatedAt : 0;
    return updatedAt < cutoff;
  });

  const totalBytes = Buffer.byteLength(JSON.stringify(rooms));
  console.log(
    `${entries.length} rooms, ~${(totalBytes / 1024).toFixed(0)} KB total ` +
      `(~${(totalBytes / Math.max(entries.length, 1)).toFixed(0)} bytes each).`,
  );
  console.log(`${stale.length} untouched for ${maxAgeDays}+ days.`);
  if (stale.length === 0) return;

  for (const [code, room] of stale.slice(0, 10)) {
    const age = room?.updatedAt
      ? `${Math.round((Date.now() - room.updatedAt) / 86_400_000)} days`
      : "no timestamp";
    console.log(`  ${code} — ${age}`);
  }
  if (stale.length > 10) console.log(`  …and ${stale.length - 10} more`);

  if (!apply) {
    console.log("\nDry run. Pass --delete to actually remove them.");
    return;
  }

  let deleted = 0;
  for (const [code] of stale) {
    const del = await fetch(`${DB}/${ROOMS_PATH}/${code}.json`, { method: "DELETE" });
    if (del.ok) {
      deleted++;
    } else {
      console.warn(`  failed to delete ${code}: ${del.status} ${del.statusText}`);
    }
  }
  console.log(`\nDeleted ${deleted} of ${stale.length}.`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
