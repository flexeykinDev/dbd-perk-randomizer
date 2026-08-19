import rawTranslations from "@/data/character-translations.ru.json";
import type { Lang } from "./i18n";
import { GENERAL_CHARACTER } from "./types";

const CHARACTER_NAME_RU: Record<string, string> = rawTranslations;



export function getCharacterName(character: string, lang: Lang): string {
  if (character === GENERAL_CHARACTER) {
    return lang === "ru" ? "Любой персонаж" : "Any Character";
  }
  if (lang === "en") return character;
  return CHARACTER_NAME_RU[character] ?? character;
}
