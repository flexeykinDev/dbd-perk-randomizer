"use client";

import { getApp, getApps, initializeApp } from "firebase/app";
import { getDatabase, type Database } from "firebase/database";

// This config is meant to be public — Firebase's client SDK is designed to
// run entirely in the browser with no secret key, and access control is
// enforced by the Realtime Database's own security rules (scoped to
// obs-rooms/<8-char-room-code>, see the project's Firebase console), not by
// hiding these values. The only thing on this site that touches Firebase is
// the OBS Overlay's cross-profile sync — see lib/obs-sync.ts for why that
// needs an external relay at all (OBS's Browser Source is a separate,
// cookie-less Chromium profile from whatever browser the main tab runs in).
const firebaseConfig = {
  apiKey: "AIzaSyCgYEjap8EhLkgDqEHcmhDz5t91dkg-s5k",
  authDomain: "dbd-perk-randomizer.firebaseapp.com",
  databaseURL: "https://dbd-perk-randomizer-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "dbd-perk-randomizer",
  storageBucket: "dbd-perk-randomizer.firebasestorage.app",
  messagingSenderId: "804219742324",
  appId: "1:804219742324:web:fa69ca4db10e94cbbb0921",
};

let dbInstance: Database | null | undefined;

/** Lazily initializes the Firebase app + Realtime Database on first use, and
 *  returns null (rather than throwing) if that ever fails — a blocked
 *  request (ad-blocker, offline, misconfigured rules) should degrade to
 *  "the OBS overlay just doesn't get cross-profile updates", not break
 *  anything for same-profile use, which already works via
 *  BroadcastChannel/localStorage regardless of Firebase. */
export function getObsDatabase(): Database | null {
  if (typeof window === "undefined") return null;
  if (dbInstance !== undefined) return dbInstance;
  try {
    const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
    dbInstance = getDatabase(app);
  } catch {
    dbInstance = null;
  }
  return dbInstance;
}
