// Guards the item/add-on relationship, which is the one thing in the
// loadout data that is wrong in a way the site displays confidently.
//
// The Items page doesn't label its tables, so the scraper has to work out
// which table holds which item type. That used to be done by table
// position, and when the source changed the positions shifted: real
// Firecrackers were dropped, Flashlights were tagged as a type with no
// add-ons at all, and Fog Vials inherited the Flashlight add-ons — so the
// site cheerfully offered a Fog Vial with a Battery and a Focus Lens. The
// scraper's own guard compared *table counts*, which had not changed, so
// nothing caught it. A player did.
//
// These assertions are about the shape of the result rather than the
// mechanism, so they hold whatever the scraper does next.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Addon, Item, ItemType } from "./types";

const dataDir = join(dirname(fileURLToPath(import.meta.url)), "..", "data");
const load = <T>(file: string): T[] =>
  JSON.parse(readFileSync(join(dataDir, file), "utf8")) as T[];

const items = load<Item>("items.json");
const addons = load<Addon>("addons.json");
const survivorAddons = addons.filter((a) => a.role === "survivor");

test("the shipped data is actually loaded", () => {
  assert.ok(items.length > 15, `expected 15+ items, got ${items.length}`);
  assert.ok(survivorAddons.length > 30, `expected 30+ survivor add-ons, got ${survivorAddons.length}`);
});

test("every item type has add-ons to go with it", () => {
  // The failure this exists for: an item whose type has no add-ons rolls
  // with an empty Add-ons column, which is what Flashlights did once they
  // were tagged `firecracker`.
  const withoutAddons = [...new Set(items.map((i) => i.itemType))].filter(
    (type) => !survivorAddons.some((a) => a.itemType === type),
  );
  assert.deepEqual(withoutAddons, [], "item types with no add-ons");
});

test("every add-on type belongs to an item that exists", () => {
  // The mirror image: add-ons parked on a type nothing can roll are
  // unreachable, which is how a mis-tagged table hides its own mistake.
  const itemTypes = new Set(items.map((i) => i.itemType));
  const orphaned = [...new Set(survivorAddons.map((a) => a.itemType))].filter(
    (type) => type && !itemTypes.has(type),
  );
  assert.deepEqual(orphaned, [], "add-on types with no matching item");
});

test("items are recognisably of the type they claim", () => {
  // A cheap sanity check on the tagging itself, since the two tests above
  // would both pass if two whole tables simply swapped labels. Each type
  // has a word that appears in its members' English names — not every
  // member (Fog Vials are "Vigo's Fog Vial" but Maps include "Bloodsense
  // Map"), so this asserts the majority rather than all.
  const marker: Partial<Record<ItemType, RegExp>> = {
    flashlight: /flashlight/i,
    "fog-vial": /fog vial/i,
    key: /key/i,
    map: /map/i,
    medkit: /kit/i,
    toolbox: /tool/i,
  };
  for (const [type, pattern] of Object.entries(marker) as [ItemType, RegExp][]) {
    const ofType = items.filter((i) => i.itemType === type);
    if (ofType.length === 0) continue;
    const matching = ofType.filter((i) => pattern.test(i.name.en));
    assert.ok(
      matching.length > ofType.length / 2,
      `${type}: only ${matching.length} of ${ofType.length} names look like it — ` +
        `e.g. ${ofType.map((i) => i.name.en).slice(0, 3).join(", ")}`,
    );
  }
});

test("every killer add-on names a character, and none sit on the general sentinel", () => {
  // ".All" is for survivor item add-ons. A killer add-on landing there
  // means a Power heading failed to resolve, and it would then be offered
  // for every killer — which happened to The Hillbilly and The First
  // during the source migration.
  const stray = addons.filter((a) => a.role === "killer" && (!a.character || a.character === "All"));
  assert.deepEqual(
    stray.slice(0, 5).map((a) => a.slug),
    [],
    `${stray.length} killer add-ons have no owning character`,
  );
});
