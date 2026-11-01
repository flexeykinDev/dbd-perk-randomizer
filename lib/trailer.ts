import trailerData from "@/data/trailer.json";
import { isAvailable } from "./availability";

/** What VideoEmbed needs. */
export interface Trailer {
  title: string;
  embedUrl: string;
}

interface TrailerFile extends Trailer {
  next?: Trailer & { availableFrom?: string };
}

/**
 * The trailer to show right now.
 *
 * The data file carries the current chapter's trailer and, optionally, the
 * next one with the day it takes over. Same mechanism as the perks and
 * add-ons: it ships with the build and swaps itself on release morning, so
 * the site is not still advertising the previous chapter to everyone who
 * arrives the day a new one lands.
 *
 * Safe to decide at module scope even though it reads the clock. VideoEmbed
 * is collapsed until someone asks for it, so the server renders only the
 * "show trailer" button - the title, the video id and the thumbnail all
 * appear after mount, and none of them are in the prerendered HTML to
 * disagree with.
 */
export function currentTrailer(now?: Date): Trailer {
  const data = trailerData as TrailerFile;
  const { next } = data;
  if (next && isAvailable(next, now)) {
    return { title: next.title, embedUrl: next.embedUrl };
  }
  return { title: data.title, embedUrl: data.embedUrl };
}
