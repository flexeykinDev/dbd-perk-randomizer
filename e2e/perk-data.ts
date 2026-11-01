// The perk list as the APP sees it, for specs that assert against counts.
//
// data/perks.json is not that list any more. It also carries Chapters that
// have shipped with the build but are not out yet (availableFrom — see
// lib/availability.ts), and the app filters those out before anything can
// roll them. A spec importing the raw file counts them and then fails
// against a UI that is behaving correctly, which is a false alarm pointing
// at the wrong place.
import perksJson from "../data/perks.json";
import { isAvailable } from "../lib/availability";

export const perks = (perksJson as { availableFrom?: string }[]).filter((p) =>
  isAvailable(p),
) as (typeof perksJson)[number][];
