// Cross-tab/cross-profile pipe between the main app and the OBS overlay
// (see use-obs-mode.ts / components/dbd/obs-overlay.tsx). Two transports,
// layered:
//
// 1. BroadcastChannel (+ a mirrored localStorage write as a "last known
//    state" for an overlay tab opened after the last generate, and a
//    `storage` event listener as a fallback) — same-origin, near-instant,
//    no network round trip. Works great when the overlay is just a second
//    tab in the *same* browser profile as the main tab.
//
// 2. Firebase Realtime Database, keyed by a random per-session "room code"
//    embedded in the OBS Overlay URL (`?room=XXXXXXXX`) — the only
//    transport that can reach OBS Studio's actual Browser Source, which
//    runs its own isolated Chromium profile with no cookies, no
//    localStorage, and no BroadcastChannel shared with the streamer's real
//    browser. This only activates once the streamer has opened the OBS
//    Overlay modal at least once (see peekRoomCode below) — a visitor who
//    never touches that feature never creates a room or writes to Firebase.
import { off, onValue, ref, set, type DataSnapshot } from "firebase/database";
import { getObsDatabase } from "./firebase";
import type { Lang } from "./i18n";
import type { PerkRole } from "./types";
import { safeGet, safeGetJSON, safeSet, safeSetJSON } from "./safe-storage";

const CHANNEL_NAME = "dbd-randomizer:obs-sync";
const STORAGE_KEY = "dbd-randomizer:obs-last-state";
const ROOM_STORAGE_KEY = "dbd-randomizer:obs-room";
const ROOM_CODE_LENGTH = 8;
// Excludes 0/O/1/I — this shows up in a URL someone may retype by hand into
// OBS, so it's worth avoiding characters that look alike.
const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export interface ObsPerk {
  slug: string;
  icon: string;
  name: { en: string; ru: string };
}

export interface ObsSyncPayload {
  role: PerkRole;
  perks: ObsPerk[];
  language: Lang;
  updatedAt: number;
  /** The build's character slug, if one is known — see randomizer-board.tsx's
   *  `shareCharacter` (an explicit character-picker choice, or a killer
   *  build's rolled Power add-ons) for exactly which. Absent when neither
   *  applies (e.g. a survivor build with no character forced). */
  character?: string;
}

let channel: BroadcastChannel | null | undefined;

function getChannel(): BroadcastChannel | null {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined")
    return null;
  if (channel === undefined) {
    try {
      channel = new BroadcastChannel(CHANNEL_NAME);
    } catch {
      channel = null;
    }
  }
  return channel;
}

function randomRoomCode(): string {
  const bytes = new Uint8Array(ROOM_CODE_LENGTH);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++)
      bytes[i] = Math.floor(Math.random() * 256);
  }
  return [...bytes]
    .map((b) => ROOM_CODE_ALPHABET[b % ROOM_CODE_ALPHABET.length])
    .join("");
}

/** This browser's OBS room code, if one already exists — never creates one.
 *  publishObsState uses this (not getOrCreateRoomCode) specifically so a
 *  visitor who's never opened the OBS Overlay modal never starts writing to
 *  Firebase on every single generate. */
export function peekRoomCode(): string | null {
  return safeGet("local", ROOM_STORAGE_KEY);
}

/** This browser's OBS room code, creating and persisting one on first call.
 *  Called from obsOverlayUrl() (lib/use-obs-mode.ts) — opening the OBS
 *  Overlay modal is the one signal we have that this visitor actually wants
 *  the cross-profile bridge. */
export function getOrCreateRoomCode(): string {
  const existing = peekRoomCode();
  if (existing) return existing;
  const code = randomRoomCode();
  safeSet("local", ROOM_STORAGE_KEY, code);
  return code;
}

export function publishObsState(
  payload: Omit<ObsSyncPayload, "updatedAt">,
): void {
  const full: ObsSyncPayload = { ...payload, updatedAt: Date.now() };
  safeSetJSON("local", STORAGE_KEY, full);
  getChannel()?.postMessage(full);

  const room = peekRoomCode();
  if (!room) return;
  const db = getObsDatabase();
  if (!db) return;
  const roomRef = ref(db, `obs-rooms/${room}`);
  set(roomRef, full).catch(() => {
    // Best-effort — same-profile sync above already covers the case where
    // this tab and the overlay share a browser, so a Firebase hiccup
    // (offline, blocked, rules misconfigured) just means the OBS overlay
    // running in a *different* profile doesn't update, not a crash.
  });
  // Deliberately no onDisconnect(...).remove() here: Firebase fires that on
  // *any* dropped connection — a laptop sleeping, a brief wifi hiccup, even
  // just backgrounding the tab — not just an intentionally closed session,
  // which wiped the overlay's last known build out from under a live stream
  // for a purely transient blip (caught by hand while testing: the room
  // vanished the moment its writer tab's connection cycled, with no way to
  // tell "gone for good" apart from "reconnecting"). A stale-but-present
  // build is a far smaller problem than that, and at a few hundred bytes
  // per room, leaving abandoned rooms in the database costs nothing
  // meaningful at this site's scale.
}

export function loadLastObsState(): ObsSyncPayload | null {
  return safeGetJSON<ObsSyncPayload | null>("local", STORAGE_KEY, null);
}

/** @param room The OBS overlay's own room code, read from its URL
 *  (`?room=...#/obs`) — when present, also subscribes to that room's
 *  Firebase path. This is the only transport that can reach the overlay
 *  when it's running in OBS's isolated browser profile. */
export function subscribeObsState(
  callback: (payload: ObsSyncPayload) => void,
  room?: string | null,
): () => void {
  if (typeof window === "undefined") return () => {};

  const ch = getChannel();
  function handleMessage(e: MessageEvent<ObsSyncPayload>) {
    callback(e.data);
  }
  ch?.addEventListener("message", handleMessage);

  function handleStorage(e: StorageEvent) {
    if (e.key !== STORAGE_KEY || !e.newValue) return;
    try {
      callback(JSON.parse(e.newValue) as ObsSyncPayload);
    } catch {
      // Ignore a malformed write — the overlay just keeps showing whatever
      // it last had rather than crashing on someone else's bad data.
    }
  }
  window.addEventListener("storage", handleStorage);

  let roomRef: ReturnType<typeof ref> | null = null;
  let handleValue: ((snapshot: DataSnapshot) => void) | null = null;
  if (room) {
    const db = getObsDatabase();
    if (db) {
      roomRef = ref(db, `obs-rooms/${room}`);
      handleValue = (snapshot) => {
        const value = snapshot.val() as ObsSyncPayload | null;
        if (value) callback(value);
      };
      onValue(roomRef, handleValue);
    }
  }

  return () => {
    ch?.removeEventListener("message", handleMessage);
    window.removeEventListener("storage", handleStorage);
    if (roomRef && handleValue) off(roomRef, "value", handleValue);
  };
}
