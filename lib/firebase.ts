"use client";

import type { Database, DataSnapshot } from "firebase/database";

// This config is meant to be public — Firebase's client SDK is designed to
// run entirely in the browser with no secret key, and access control is
// enforced by the Realtime Database's own security rules, not by hiding
// these values. The rules are in the README and grant exactly two things:
// one OBS room, reachable only by its 8-character code (codes cannot be
// listed), and the Daily Challenge counter, which can only go up by one.
//
// Two features use it: the OBS Overlay's cross-profile sync — see
// lib/obs-sync.ts for why that needs an external relay at all (OBS's Browser
// Source is a separate, cookie-less Chromium profile from whatever browser
// the main tab runs in) — and the Daily Challenge count in daily-count.ts.
const firebaseConfig = {
  apiKey: "AIzaSyCgYEjap8EhLkgDqEHcmhDz5t91dkg-s5k",
  authDomain: "dbd-perk-randomizer.firebaseapp.com",
  databaseURL: "https://dbd-perk-randomizer-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "dbd-perk-randomizer",
  storageBucket: "dbd-perk-randomizer.firebasestorage.app",
  messagingSenderId: "804219742324",
  appId: "1:804219742324:web:fa69ca4db10e94cbbb0921",
};

/* Everything the two callers need, handed over together.
 *
 * The database alone is not enough: `ref`, `onValue` and friends come from
 * the same package, and a static `import { ref } from "firebase/database"`
 * anywhere is what pulls the whole SDK back into the first-paint bundle —
 * which is the entire thing this file exists to avoid. Importing them here
 * and passing them out keeps that import in one place where it can be
 * guaranteed dynamic. */
export interface FirebaseBundle {
  db: Database;
  ref: typeof import("firebase/database").ref;
  set: typeof import("firebase/database").set;
  update: typeof import("firebase/database").update;
  onValue: typeof import("firebase/database").onValue;
  off: typeof import("firebase/database").off;
  increment: typeof import("firebase/database").increment;
}

export type { DataSnapshot };

/** One import, one app, however many callers. Caching the *promise* rather
 *  than the result means two features asking at once share a single network
 *  request instead of racing to initialise twice. */
let bundle: Promise<FirebaseBundle | null> | null = null;

/**
 * Loads the Firebase SDK and opens the database, or resolves to null.
 *
 * Dynamically imported — the same treatment lib/use-share-export.ts gives
 * html2canvas, and for the same reason. Measured before this change, the
 * chunk carrying Firebase was referenced straight from index.html at 47.9KB
 * gzipped, downloaded and parsed by every visitor although the README's own
 * position is that someone who never opens the OBS overlay or the Daily
 * Challenge never touches it.
 *
 * Null rather than throwing, exactly as the synchronous version did: a
 * blocked request (ad-blocker, offline, rules that deny this path) must
 * degrade to "the OBS overlay doesn't get cross-profile updates" and
 * "there's no player count today", never to an error anybody sees. The
 * failure is cached too — a browser extension blocking the SDK will block it
 * on the next call as well, and retrying per roll would be noise.
 */
export function loadFirebase(): Promise<FirebaseBundle | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  bundle ??= (async () => {
    try {
      const [{ getApp, getApps, initializeApp }, database] = await Promise.all([
        import("firebase/app"),
        import("firebase/database"),
      ]);
      const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
      return {
        db: database.getDatabase(app),
        ref: database.ref,
        set: database.set,
        update: database.update,
        onValue: database.onValue,
        off: database.off,
        increment: database.increment,
      };
    } catch {
      return null;
    }
  })();
  return bundle;
}
