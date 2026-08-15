import rawTranslations from "@/data/character-translations.ru.json";
import type { Lang } from "./i18n";

const CHARACTER_NAME_RU: Record<string, string> = rawTranslations;

/** Perks usable by every character are scraped with this sentinel instead
 *  of a real name. */
const ANY_CHARACTER = ".All";

export function getCharacterName(character: string, lang: Lang): string {
  if (character === ANY_CHARACTER) {
    return lang === "ru" ? "Любой персонаж" : "Any Character";
  }
  if (lang === "en") return character;
  return CHARACTER_NAME_RU[character] ?? character;
}
