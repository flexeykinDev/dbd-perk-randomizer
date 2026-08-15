import type { Perk, PerkRole } from "./types";

export interface PerkTag {
  id: string;
  ru: string;
  en: string;
}

const SURVIVOR_TAGS: PerkTag[] = [
  { id: "generator", ru: "Генераторы", en: "Generator" },
  { id: "healing", ru: "Лечение", en: "Healing" },
  { id: "aura", ru: "Аура", en: "Aura" },
  { id: "exhaustion", ru: "Изнурение", en: "Exhaustion" },
  { id: "stealth", ru: "Скрытность", en: "Stealth" },
  { id: "totems", ru: "Тотемы", en: "Totems" },
  { id: "unhooking", ru: "Снятие с крюка", en: "Unhooking" },
  { id: "items", ru: "Предметы", en: "Items" },
];

const KILLER_TAGS: PerkTag[] = [
  { id: "gen-regression", ru: "Откат генераторов", en: "Gen Regression" },
  { id: "aura-info", ru: "Аура/Инфо", en: "Aura/Info" },
  { id: "hex", ru: "Хекс", en: "Hex" },
  { id: "scourge-hook", ru: "Особый крюк", en: "Scourge Hook" },
  { id: "chase", ru: "Погоня", en: "Chase" },
  { id: "exposure", ru: "Разоблачение", en: "Exposure" },
];

export function getTagsForRole(role: PerkRole): PerkTag[] {
  return role === "survivor" ? SURVIVOR_TAGS : KILLER_TAGS;
}

// Keyword rules matched against the scraped English name+description
// (lowercased). This is a heuristic classifier, not hand-curated data —
// good enough for quick filtering, not guaranteed 100% complete/accurate
// for every perk's nuance. A perk can match multiple tags.
const TAG_RULES: Record<string, RegExp> = {
  generator: /\bgenerator|\btoolbox\b|repair(ing|s)?\b/,
  healing: /\bheal(s|ing|ed)?\b|medkit|self-care/,
  aura: /\baura/,
  exhaustion: /\bexhaust(ed|ion)\b/,
  stealth: /undetectable|scratch marks|terror radius|imperceptible|grunt of pain|footstep/,
  totems: /\btotem|\bhex\b|\bboon\b/,
  unhooking: /unhook|hook state|\bsacrifice\b|deep wound|struggl/,
  items: /\bitem\b|add-on|\bcharges?\b/,

  "gen-regression": /generator[^.]*(regress|explod|block)|regress[^.]*generator|kick(ed|ing)? a generator|block(s|ed|ing)? (a |the )?generator/,
  "aura-info": /\baura|\breveal(s|ed|ing)?\b|scratch marks|\btrack(s|ing)?\b/,
  chase: /\bvault(s|ing|ed)?\b|\bpallet(s)?\b|\blunge\b|\bhaste\b|movement speed|faster\b/,
  exposure: /\bexposed\b|one-hit down|dying state/,
};

function textFor(perk: Perk): string {
  return `${perk.name.en} ${perk.description}`.toLowerCase();
}

export function getTagsForPerk(perk: Perk): string[] {
  const text = textFor(perk);
  const tags: string[] = [];

  if (perk.role === "killer") {
    if (/^hex:/i.test(perk.name.en)) tags.push("hex");
    if (/^scourge hook:/i.test(perk.name.en)) tags.push("scourge-hook");
  }

  const candidateTagIds = getTagsForRole(perk.role).map((t) => t.id);
  for (const tagId of candidateTagIds) {
    if (tags.includes(tagId)) continue;
    const rule = TAG_RULES[tagId];
    if (rule && rule.test(text)) tags.push(tagId);
  }

  return tags;
}
