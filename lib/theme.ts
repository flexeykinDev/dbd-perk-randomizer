export const THEME_STORAGE_KEY = "dbd-randomizer:theme";

/** The three grounds the site can be painted on.
 *
 *  `pixel` is dark like `dark` is — it is a different visual language, not a
 *  different brightness — so anything asking "is this the light theme" must
 *  keep comparing against `"light"` rather than against "not dark". */
export const THEMES = ["dark", "light", "pixel"] as const;
export type Theme = (typeof THEMES)[number];

export function isTheme(value: unknown): value is Theme {
  return typeof value === "string" && (THEMES as readonly string[]).includes(value);
}

/** The next theme in the cycle, so the one toggle can reach all three. */
export function nextTheme(current: Theme): Theme {
  return THEMES[(THEMES.indexOf(current) + 1) % THEMES.length];
}
