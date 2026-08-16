import idsData from "@/data/loadout-ids.json";
import type { LoadoutKind } from "./types";

// Same stable-ID scheme as lib/perk-ids.ts, just keyed "kind:slug" (see
// scripts/scrape-loadout.ts) since an item, add-on, and offering could
// otherwise slugify to the same string.
const KEY_TO_ID: Record<string, number> = idsData;
const ID_TO_KEY = new Map<number, string>(Object.entries(KEY_TO_ID).map(([key, id]) => [id, key]));

export function getIdForLoadoutPiece(kind: LoadoutKind, slug: string): number | undefined {
  return KEY_TO_ID[`${kind}:${slug}`];
}

export function getLoadoutPieceKeyForId(id: number): { kind: LoadoutKind; slug: string } | undefined {
  const key = ID_TO_KEY.get(id);
  if (!key) return undefined;
  const separatorIndex = key.indexOf(":");
  const kind = key.slice(0, separatorIndex) as LoadoutKind;
  const slug = key.slice(separatorIndex + 1);
  return { kind, slug };
}
