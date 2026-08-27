// useExclusions, rendered.
//
// mergeExclusions is covered as a pure function in hooks.test.ts. This is the
// half that needed a DOM: three persisted sets, real localStorage underneath
// them, and hydrate() — the path a returning visitor actually takes, and the
// one lib/safe-storage.ts is designed to swallow every failure of.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { StrictMode } from "react";
import { act, renderHook } from "@testing-library/react";
import { useExclusions, type ExclusionsController } from "./use-exclusions";
import { getPerksByRole } from "./perks";
import type { PerkRole } from "./types";

const EXCLUDED_KEY = "dbd-randomizer:excluded-perks";
const FAVORITE_KEY = "dbd-randomizer:favorite-perks";

interface Options {
  role?: PerkRole;
  themeTag?: string | null;
  alsoExcluded?: ReadonlySet<string> | null;
}

function setup({ role = "survivor", themeTag = null, alsoExcluded = null }: Options = {}) {
  /* StrictMode, because that is how the app runs — Next enables it by
     default and this project does not turn it off. It double-invokes render
     and setState updaters to surface impurity, so a hook that passes here is
     a hook that behaves in development. */
  const view = renderHook(
    (props: Required<Options>) =>
      useExclusions({
        role: props.role,
        mounted: true,
        themeTag: props.themeTag,
        alsoExcluded: props.alsoExcluded,
      }),
    { initialProps: { role, themeTag, alsoExcluded }, wrapper: StrictMode },
  );
  return {
    get x(): ExclusionsController {
      return view.result.current;
    },
    update: (next: Partial<Options>) =>
      act(() => view.rerender({ role, themeTag, alsoExcluded, ...next } as Required<Options>)),
  };
}

const survivorSlugs = () => getPerksByRole("survivor").map((p) => p.slug);

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

test("a toggled exclusion reaches localStorage, and hydrate reads it back", () => {
  /* Two different code paths, and only the write half is obvious. hydrate is
     what a returning visitor experiences, and safe-storage swallows every
     failure by design — so a hydrate that silently did nothing would leave a
     write-only test perfectly green. */
  const first = setup();
  act(() => first.x.togglePerk("sprint-burst"));
  assert.ok(first.x.perkSlugs.has("sprint-burst"));
  assert.ok(
    (localStorage.getItem(EXCLUDED_KEY) ?? "").includes("sprint-burst"),
    "the exclusion never reached storage",
  );

  const second = setup();
  assert.equal(second.x.perkSlugs.size, 0, "nothing is restored before hydrate runs");
  act(() => second.x.hydrate());
  assert.ok(second.x.perkSlugs.has("sprint-burst"), "hydrate did not read the saved set back");
});

test("hydrate restores all three sets, not just the first", () => {
  const first = setup();
  act(() => first.x.togglePerk("a-perk"));
  act(() => first.x.toggleFavorite("a-favourite"));
  act(() => first.x.toggleLoadoutPiece("item", "toolbox"));

  const second = setup();
  act(() => second.x.hydrate());
  assert.ok(second.x.perkSlugs.has("a-perk"), "exclusions lost");
  assert.ok(second.x.favoriteSlugs.has("a-favourite"), "favourites lost");
  assert.ok(second.x.loadoutKeys.has("item:toolbox"), "loadout exclusions lost");
});

test("exclusions and favourites are separate sets", () => {
  // They are the same shape and sit behind the same panel, so crossing the
  // wires would look almost right: a favourite would gray out instead of
  // being starred.
  const s = setup();
  act(() => s.x.togglePerk("excluded-one"));
  act(() => s.x.toggleFavorite("favourite-one"));

  assert.ok(!s.x.favoriteSlugs.has("excluded-one"));
  assert.ok(!s.x.perkSlugs.has("favourite-one"));
  assert.ok((localStorage.getItem(FAVORITE_KEY) ?? "").includes("favourite-one"));
  assert.ok(!(localStorage.getItem(FAVORITE_KEY) ?? "").includes("excluded-one"));
});

test("a loadout piece is keyed kind:slug, and never collides with a perk slug", () => {
  const s = setup();
  act(() => s.x.toggleLoadoutPiece("addon", "bffs"));
  assert.ok(s.x.loadoutKeys.has("addon:bffs"));
  assert.ok(!s.x.loadoutKeys.has("bffs"), "the bare slug must not be what is stored");
  assert.equal(s.x.perkSlugs.size, 0, "a loadout exclusion is not a perk exclusion");
});

test("bulk setting excludes and re-includes the whole list", () => {
  const s = setup();
  const some = survivorSlugs().slice(0, 20);

  act(() => s.x.setManyPerks(some, true));
  assert.equal(s.x.perkSlugs.size, 20);

  act(() => s.x.setManyPerks(some, false));
  assert.equal(s.x.perkSlugs.size, 0);
});

test("reset clears only the role it was asked about", () => {
  /* The saved set spans both roles — switching role does not wipe it — so a
     reset that ignored its argument would silently clear the other role's
     choices too, and nothing on screen would say so. */
  const s = setup();
  const survivor = survivorSlugs()[0];
  const killer = getPerksByRole("killer")[0].slug;
  act(() => s.x.setManyPerks([survivor, killer], true));
  assert.equal(s.x.perkSlugs.size, 2);

  act(() => s.x.resetPerksForRole("survivor"));
  assert.ok(!s.x.perkSlugs.has(survivor), "the survivor exclusion should be gone");
  assert.ok(s.x.perkSlugs.has(killer), "the killer exclusion must survive");
});

test("the available pool is what is left after everything", () => {
  const s = setup();
  const total = s.x.availableCount;
  assert.ok(total > 100, `expected the survivor pool, got ${total}`);

  act(() => s.x.setManyPerks(survivorSlugs().slice(0, 10), true));
  assert.equal(s.x.availableCount, total - 10);
  assert.equal(s.x.availablePool.length, s.x.availableCount);
});

test("Battle Royale attrition narrows the pool without touching the saved set", () => {
  const spent = new Set(survivorSlugs().slice(0, 5));
  const s = setup({ alsoExcluded: spent });

  assert.equal(s.x.perkSlugs.size, 0, "attrition is not a manual exclusion");
  assert.equal(s.x.combinedPerks.size, 5, "but the roll still has to avoid it");
});

test("a theme narrows the perk pool and leaves the loadout alone", () => {
  const withTheme = setup({ themeTag: "aura" });
  const without = setup();

  assert.ok(
    withTheme.x.availableCount < without.x.availableCount,
    "the theme did not narrow anything",
  );
  assert.ok(withTheme.x.availableCount > 0, "and it must not empty the pool");
  assert.equal(
    withTheme.x.combinedLoadout.size,
    0,
    "themes are a perk idea — a loadout must not be filtered by one",
  );
});

test("the pool panel opens on the kind it was asked for", () => {
  const s = setup();
  assert.equal(s.x.panelOpen, false);

  act(() => s.x.openPanel("loadout"));
  assert.equal(s.x.panelOpen, true);
  assert.equal(s.x.panelKind, "loadout");

  act(() => s.x.closePanel());
  assert.equal(s.x.panelOpen, false);
  assert.equal(s.x.panelKind, "loadout", "closing does not reset which panel it was");
});
