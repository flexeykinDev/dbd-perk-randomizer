import type { Lang } from "../i18n";
import type { DescribableEntity } from "./types";

import loadoutOverrides from "@/data/overrides/loadout.json";

/* The hand-written Core Effects, looked up by identity.
 *
 * The lookup is keyed `kind:slug`, which is why DescribableEntity requires
 * both — see the note on that type. Reading them off a cast used to make
 * "pass an object with no identity" a legal call that silently returned every
 * override as absent, and it did exactly that in the UI for weeks. */

const CORE_EFFECT_OVERRIDES = loadoutOverrides.entries as Record<
  string,
  { en?: string; ru?: string } | string
>;

export function overriddenCore(entity: DescribableEntity, lang: Lang): string | null {
  const entry = CORE_EFFECT_OVERRIDES[`${entity.kind}:${entity.slug}`];
  if (!entry || typeof entry === "string") return null;
  return entry[lang] ?? null;
}
