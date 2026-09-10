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
// Needs a credential, because it LISTS rooms and nothing else may. A room
// code is the capability: the overlay reads and writes the one room it knows
// the code of, and the database rules refuse to enumerate them — otherwise
// anyone could list every streamer's code and write to their overlay. This
// used to run with no credentials only because the database was still in
// Firebase's open test mode, which is exactly the hole that listing was.
//
// So: FIREBASE_DB_SECRET (a Realtime Database secret, Firebase console →
// Project settings → Service accounts → Database secrets) if it is set, and
// otherwise a clean skip. Being refused is the rules working, not a failure
// worth a red run every Monday.
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

  const secret = process.env.FIREBASE_DB_SECRET;
  const auth = secret ? `?auth=${encodeURIComponent(secret)}` : "";

  const res = await fetch(`${DB}/${ROOMS_PATH}.json${auth}`);
  if ((res.status === 401 || res.status === 403) && !secret) {
    console.log(
      "::notice::Skipped — the database rules refuse to list rooms without a credential. " +
        "Set the FIREBASE_DB_SECRET repository secret to enable pruning.",
    );
    return;
  }
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
    const del = await fetch(`${DB}/${ROOMS_PATH}/${code}.json${auth}`, { method: "DELETE" });
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
