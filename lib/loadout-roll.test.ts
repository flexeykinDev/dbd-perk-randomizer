// Exercises the roll itself, rather than the data it draws from.
//
// lib/loadout.test.ts asserts the data hangs together — every item type
// has add-ons, every add-on type has an item. That is necessary and it was
// not sufficient: the Fog Vial bug was reported from the live site by a
// player, because what they saw was not a missing relationship but a
// *wrong pairing*, and nothing was checking the thing that does the
// pairing.
//
// So these run the real roller many times over the real data and assert
// what a player would notice. Seeded, so a failure names a seed that
// reproduces it exactly instead of a run that happened to be unlucky.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getKillerCharacters,
  getRandomLoadout,
  getSeededLoadout,
  items,
  offerings,
} from "./loadout";
import { createSeededRandom } from "./seeded-random";
import type { Loadout, LoadoutSlots, PerkRole } from "./types";

const ALL_SLOTS: LoadoutSlots = { item: true, addons: true, offering: true };

/** Everything a roll produced, in a form two rolls can be compared by. */
const pieceSlugs = (loadout: Loadout) => [
  loadout.character,
  loadout.item?.slug ?? null,
  ...loadout.addons.map((a) => a.slug),
  loadout.offering?.slug ?? null,
];

/** Enough rolls to hit every item type many times over — there are only a
 *  handful, and the bug being guarded against affected a whole type at
 *  once, so this is generous rather than tuned. */
const ROLLS = 600;

/** Rolls with a seed derived from `i`, so any failure below can be
 *  reproduced by rolling that single seed again. */
const rollN = (role: PerkRole, slots: LoadoutSlots = ALL_SLOTS, forced?: string | null) =>
  Array.from({ length: ROLLS }, (_, i) => ({
    seed: `roll-${role}-${i}`,
    loadout: getRandomLoadout(role, slots, undefined, createSeededRandom(`roll-${role}-${i}`), forced),
  }));

test("a survivor's add-ons always fit the item they came with", () => {
  // The exact failure a player reported: a Fog Vial holding a Battery and
  // a Focus Lens, which are Flashlight add-ons.
  for (const { seed, loadout } of rollN("survivor")) {
    if (!loadout.item) continue;
    for (const addon of loadout.addons) {
      assert.equal(
        addon.itemType,
        loadout.item.itemType,
        `${seed}: "${addon.name.en}" (${addon.itemType}) rolled with ` +
          `"${loadout.item.name.en}" (${loadout.item.itemType})`,
      );
    }
  }
});

test("every item type actually gets rolled with add-ons", () => {
  // The other half of the same bug, and the one the pairing check above
  // would happily pass: Flashlights were tagged with a type that had no
  // add-ons at all, so they rolled with an empty column rather than a
  // wrong one. Nothing mismatched, because nothing was there.
  const seenWithAddons = new Set<string>();
  for (const { loadout } of rollN("survivor")) {
    if (loadout.item && loadout.addons.length > 0) seenWithAddons.add(loadout.item.itemType);
  }
  const everyType = [...new Set(items.map((i) => i.itemType))];
  assert.deepEqual(
    everyType.filter((t) => !seenWithAddons.has(t)),
    [],
    "item types that never rolled with a single add-on",
  );
});

test("a killer's add-ons always belong to the killer that was rolled", () => {
  // The same class of mistake on the other side: an add-on whose Power
  // heading failed to resolve lands on the general sentinel and would be
  // offered for every killer.
  for (const { seed, loadout } of rollN("killer")) {
    if (!loadout.character) continue;
    for (const addon of loadout.addons) {
      assert.equal(
        addon.character,
        loadout.character,
        `${seed}: "${addon.name.en}" belongs to ${addon.character}, ` +
          `but the roll picked ${loadout.character}`,
      );
    }
  }
});

test("picking a killer is honoured, and its add-ons follow", () => {
  const killer = getKillerCharacters()[0];
  for (const { seed, loadout } of rollN("killer", ALL_SLOTS, killer)) {
    assert.equal(loadout.character, killer, `${seed}: forced character ignored`);
    for (const addon of loadout.addons) {
      assert.equal(addon.character, killer, `${seed}: "${addon.name.en}" is not ${killer}'s`);
    }
  }
});

test("a roll never repeats an add-on", () => {
  for (const role of ["survivor", "killer"] as const) {
    for (const { seed, loadout } of rollN(role)) {
      const slugs = loadout.addons.map((a) => a.slug);
      assert.equal(new Set(slugs).size, slugs.length, `${seed}: duplicate add-on in ${slugs.join(", ")}`);
    }
  }
});

test("an offering is always one this role can actually burn", () => {
  for (const role of ["survivor", "killer"] as const) {
    for (const { seed, loadout } of rollN(role)) {
      if (!loadout.offering) continue;
      assert.ok(
        loadout.offering.role === role || loadout.offering.role === "both",
        `${seed}: "${loadout.offering.name.en}" is ${loadout.offering.role}-only`,
      );
    }
  }
});

test("turning the item slot off leaves no add-ons behind", () => {
  // A survivor add-on without its item isn't equippable, so it must not
  // be rolled on its own.
  for (const { seed, loadout } of rollN("survivor", { item: false, addons: true, offering: true })) {
    assert.equal(loadout.item, null, `${seed}: item rolled while the slot was off`);
    assert.deepEqual(loadout.addons, [], `${seed}: add-ons rolled without an item`);
  }
});

test("an excluded piece never comes back", () => {
  // Exclusions are the one place where quietly ignoring the pool would look
  // to the player exactly like bad luck, so it would go unreported.
  // Excluding a whole item type also checks the *derived* pool: if add-ons
  // were still drawn for an item that can no longer be rolled, this catches
  // it as a type mismatch rather than as a missing exclusion.
  const excludedType = items[0].itemType;
  const excluded = new Set([
    ...items.filter((i) => i.itemType === excludedType).map((i) => `item:${i.slug}`),
    ...offerings.slice(0, 5).map((o) => `offering:${o.slug}`),
  ]);
  for (let i = 0; i < ROLLS; i++) {
    const loadout = getRandomLoadout("survivor", ALL_SLOTS, excluded, createSeededRandom(`excluded-${i}`));
    if (loadout.item) {
      assert.ok(
        !excluded.has(`item:${loadout.item.slug}`),
        `excluded-${i}: rolled "${loadout.item.name.en}", which was excluded`,
      );
      assert.notEqual(loadout.item.itemType, excludedType, `excluded-${i}: whole type was excluded`);
      for (const addon of loadout.addons) {
        assert.equal(addon.itemType, loadout.item.itemType, `excluded-${i}: "${addon.name.en}" mismatched`);
      }
    }
    if (loadout.offering) {
      assert.ok(
        !excluded.has(`offering:${loadout.offering.slug}`),
        `excluded-${i}: rolled "${loadout.offering.name.en}", which was excluded`,
      );
    }
  }
});

test("the Daily Challenge roll obeys the same pairing rules", () => {
  // getSeededLoadout is a second, near-identical implementation — the one
  // every player shares on a given day. It picks its own add-on pool from
  // the item it rolled, so it can drift from getRandomLoadout in exactly
  // the way that produced the Fog Vial bug, and a shared roll being wrong
  // is wrong for everyone at once.
  for (let i = 0; i < ROLLS; i++) {
    const seed = `2026-08-${(i % 28) + 1}-${i}`;
    const survivor = getSeededLoadout("survivor", ALL_SLOTS, seed);
    if (survivor.item) {
      for (const addon of survivor.addons) {
        assert.equal(
          addon.itemType,
          survivor.item.itemType,
          `${seed}: "${addon.name.en}" (${addon.itemType}) with a ${survivor.item.itemType}`,
        );
      }
    }
    const killer = getSeededLoadout("killer", ALL_SLOTS, seed);
    for (const addon of killer.addons) {
      assert.equal(addon.character, killer.character, `${seed}: "${addon.name.en}" is not the rolled killer's`);
    }
  }
});

test("the same seed always gives the same loadout", () => {
  // What "Daily Challenge" and shared seed links promise. A pool that is
  // filtered non-deterministically, or an unseeded Math.random left in one
  // branch, breaks this without breaking anything else.
  for (let i = 0; i < 50; i++) {
    const seed = `repeat-${i}`;
    for (const role of ["survivor", "killer"] as const) {
      const a = getSeededLoadout(role, ALL_SLOTS, seed);
      const b = getSeededLoadout(role, ALL_SLOTS, seed);
      assert.deepEqual(pieceSlugs(b), pieceSlugs(a), `${seed}: ${role} roll is not reproducible`);
    }
  }
});
