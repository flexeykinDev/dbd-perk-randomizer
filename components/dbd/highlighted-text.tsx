// Renders "**term**"-marked spans (see lib/perk-description.ts) as bold
// amber highlights, matching the game's own callout style for perk values.
//
// Uses --highlight rather than --accent: the accent is the site's neutral
// chrome colour (bone on dark, ink on light), and painting values with it
// would make them the same colour as the surrounding body text — the one
// thing a highlight must never be. These spans are the numbers and Status
// Effect names, i.e. the actual information in a perk, so they keep a hue
// of their own.
export function Highlighted({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith("**") && part.endsWith("**") ? (
          <strong key={i} className="font-semibold text-highlight">
            {part.slice(2, -2)}
          </strong>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}
