/** One frame on the export card: a perk, or a loadout piece.
 *
 *  Its own module so share-card-layout.ts can name it without importing the
 *  component — the layout is pure arithmetic and must stay loadable outside a
 *  renderer. share-card.tsx re-exports it, which is where callers have always
 *  imported it from. */
export interface ShareCardPiece {
  slug: string;
  icon: string;
  name: { en: string; ru: string };
  /** Present on loadout pieces; drives the small label under each frame. */
  kind?: string;
}
