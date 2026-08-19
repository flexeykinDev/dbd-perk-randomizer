import presetsData from "@/data/build-presets.json";
import { getPerkBySlug } from "./perks";
import type { Perk, PerkRole } from "./types";

export interface BuildPreset {
  id: string;
  role: PerkRole;
  name: { en: string; ru: string };
  description: { en: string; ru: string };
  /** Perk slugs, in the order they should be shown. */
  perks: string[];
}

const presets = (presetsData as { presets: BuildPreset[] }).presets;

export function getBuildPresets(role: PerkRole): BuildPreset[] {
  return presets.filter((preset) => preset.role === role);
}

/** The preset's perks as actual Perk objects.
 *
 *  Silently drops a slug that no longer resolves rather than throwing: a
 *  preset going stale is a content problem, caught by
 *  lib/build-presets.test.ts on every `npm test`, and it shouldn't be able
 *  to take the page down in the meantime. */
export function resolvePreset(preset: BuildPreset): Perk[] {
  return preset.perks
    .map((slug) => getPerkBySlug(slug))
    .filter((perk): perk is Perk => !!perk && perk.role === preset.role);
}
