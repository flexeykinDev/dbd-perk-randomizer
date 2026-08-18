import type { PerkRole } from "@/lib/types";

// Renders "**term**"-marked spans (see lib/perk-description.ts) — the
// numbers and Status Effect names in a perk's text — as bold, role-tinted
// callouts.
//
// Tinted by role rather than given a colour of its own. The page already
// carries exactly two meaningful colours, sky for Survivor and rose for
// Killer, and a separate highlight hue only added a third that competed
// with both. Taking the role's colour introduces nothing new, matches the
// role label sitting directly above the text, and ties each value to the
// side it belongs to.
//
// The tokens are deliberately not lib/role-color.ts's sky-400/rose-400:
// those are picked for a dark card and would fall to roughly 2:1 against
// the light theme's white surface, so --highlight-* defines a shade per
// theme instead (see app/globals.css).
const ROLE_HIGHLIGHT: Record<PerkRole, string> = {
  survivor: "text-highlight-survivor",
  killer: "text-highlight-killer",
};

export function Highlighted({ text, role }: { text: string; role: PerkRole }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith("**") && part.endsWith("**") ? (
          <strong key={i} className={`font-semibold ${ROLE_HIGHLIGHT[role]}`}>
            {part.slice(2, -2)}
          </strong>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}
