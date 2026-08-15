// Every localStorage/sessionStorage call in the app goes through here.
// Reads/writes can throw for reasons that have nothing to do with our data —
// Safari private browsing throws on setItem, quota can be exceeded, some
// browser extensions block storage entirely — and none of that should ever
// crash the app. Callers get a safe default (null / false / the fallback
// they passed) instead of a thrown exception.
type StorageArea = "local" | "session";

function getStorage(area: StorageArea): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return area === "local" ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

export function safeGet(area: StorageArea, key: string): string | null {
  try {
    return getStorage(area)?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function safeSet(area: StorageArea, key: string, value: string): void {
  try {
    getStorage(area)?.setItem(key, value);
  } catch {
    // Storage full or unavailable — the app keeps working, it just won't
    // remember this particular preference for next time.
  }
}

export function safeRemove(area: StorageArea, key: string): void {
  try {
    getStorage(area)?.removeItem(key);
  } catch {
    // ignore
  }
}

/** JSON.parse a stored value, falling back cleanly on missing/invalid JSON
 *  (e.g. a value written by an older, incompatible version of the app). */
export function safeGetJSON<T>(area: StorageArea, key: string, fallback: T): T {
  const raw = safeGet(area, key);
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function safeSetJSON(area: StorageArea, key: string, value: unknown): void {
  try {
    safeSet(area, key, JSON.stringify(value));
  } catch {
    // Circular reference or similar — shouldn't happen with our own data
    // shapes, but don't let it take the app down if it ever does.
  }
}
