"use client";

// A Set of strings that saves itself.
//
// The board kept three of these — excluded perks, excluded loadout pieces,
// favourites — and each had grown its own toggle, its own bulk setter and
// its own "clear everything belonging to this role", all writing the same
// two lines of localStorage by hand. Six functions that differed only in
// which key they wrote to.
//
// Persisting inside the updater rather than in an effect is deliberate: it
// keeps the write next to the change that caused it, and avoids a
// save-on-every-render effect that would also fire for the initial
// hydration and write back what it just read.
import { useCallback, useState } from "react";
import { safeGetJSON, safeSetJSON } from "./safe-storage";

export interface PersistedSet {
  values: ReadonlySet<string>;
  has: (value: string) => boolean;
  toggle: (value: string) => void;
  /** Adds or removes many at once — one write, one render, rather than one
   *  of each per item. */
  setMany: (values: readonly string[], present: boolean) => void;
  /** Drops everything the predicate matches. Used to clear one role's
   *  entries while leaving the other role's alone. */
  removeWhere: (predicate: (value: string) => boolean) => void;
  /** Replaces the whole set from storage. Called once after mount, since a
   *  lazy initializer would read localStorage during the server render. */
  hydrate: () => void;
}

export function usePersistedSet(storageKey: string): PersistedSet {
  const [values, setValues] = useState<ReadonlySet<string>>(new Set());

  const write = useCallback(
    (next: Set<string>) => {
      safeSetJSON("local", storageKey, [...next]);
      return next;
    },
    [storageKey],
  );

  return {
    values,
    has: useCallback((value: string) => values.has(value), [values]),

    toggle: useCallback(
      (value: string) =>
        setValues((prev) => {
          const next = new Set(prev);
          if (next.has(value)) next.delete(value);
          else next.add(value);
          return write(next);
        }),
      [write],
    ),

    setMany: useCallback(
      (incoming: readonly string[], present: boolean) =>
        setValues((prev) => {
          const next = new Set(prev);
          for (const value of incoming) {
            if (present) next.add(value);
            else next.delete(value);
          }
          return write(next);
        }),
      [write],
    ),

    removeWhere: useCallback(
      (predicate: (value: string) => boolean) =>
        setValues((prev) => write(new Set([...prev].filter((v) => !predicate(v))))),
      [write],
    ),

    hydrate: useCallback(() => {
      // Validates the parsed shape, not just that it parsed — a value left
      // by some future or incompatible version of the app could be valid
      // JSON of the wrong shape (an object rather than an array), and
      // `new Set()` on a non-iterable throws rather than coming back
      // empty.
      const stored = safeGetJSON<unknown>("local", storageKey, []);
      const values = Array.isArray(stored) ? stored.filter((v) => typeof v === "string") : [];
      setValues(new Set(values));
    }, [storageKey]),
  };
}
