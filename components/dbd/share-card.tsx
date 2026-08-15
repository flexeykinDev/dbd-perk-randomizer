import type { Ref } from "react";
import { withBasePath } from "@/lib/asset-path";
import { ruPlural } from "@/lib/i18n";
import { ROLE_COLOR } from "@/lib/role-color";
import type { Perk, PerkRole } from "@/lib/types";

// html2canvas (1.4.x, the current release) predates browser support for
// oklch()/oklab()/color-mix() — colors this app's Tailwind classes resolve
// to at runtime (Tailwind v4's palette is defined in oklch) — and either
// throws or silently mis-renders when it hits one. Every color here is a
// literal hex/rgba value via inline styles specifically so this component
// never touches a Tailwind class or CSS custom property.
const BACKGROUND = "#121212";
const SURFACE = "#1e2228";
const BORDER = "rgba(255,255,255,0.08)";
const FOREGROUND = "#edeef0";
const MUTED = "#9096a3";

const ROLE_LABEL: Record<PerkRole, { ru: string; en: string }> = {
  survivor: { ru: "Выживший", en: "Survivor" },
  killer: { ru: "Убийца", en: "Killer" },
};

export type ShareCardLayout = "landscape" | "story";

export function ShareCard({
  ref,
  perks,
  role,
  language,
  layout = "landscape",
}: {
  ref?: Ref<HTMLDivElement>;
  perks: Perk[];
  role: PerkRole;
  language: "en" | "ru";
  /** "landscape" (default): a single row, sized to fit the content — used
   *  for the regular "Download image" button. "story": a fixed 1080x1920
   *  canvas with perks in a 2-column grid, for Instagram/TikTok Stories. */
  layout?: ShareCardLayout;
}) {
  const accent = ROLE_COLOR[role].solid;
  const roleName = ROLE_LABEL[role][language];
  const isStory = layout === "story";
  const columns = isStory ? Math.min(Math.max(perks.length, 1), 2) : Math.max(perks.length, 1);
  const iconSize = isStory ? 180 : 112;

  return (
    <div
      ref={ref}
      style={{
        width: isStory ? 1080 : 900,
        height: isStory ? 1920 : undefined,
        display: "flex",
        flexDirection: "column",
        justifyContent: isStory ? "center" : undefined,
        gap: isStory ? 56 : 32,
        padding: isStory ? 80 : 48,
        background: BACKGROUND,
        color: FOREGROUND,
        fontFamily: "Arial, Helvetica, sans-serif",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: isStory ? "column" : "row",
          alignItems: "center",
          gap: isStory ? 20 : 16,
        }}
      >
        <div
          style={{
            display: "flex",
            width: isStory ? 88 : 56,
            height: isStory ? 88 : 56,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: isStory ? 22 : 14,
            background: SURFACE,
            border: `1px solid ${BORDER}`,
          }}
        >
          <div
            style={{
              width: isStory ? 40 : 26,
              height: isStory ? 40 : 26,
              borderRadius: isStory ? 12 : 8,
              border: `${isStory ? 4 : 3}px solid ${accent}`,
            }}
          />
        </div>
        <div style={{ textAlign: isStory ? "center" : "left" }}>
          <div style={{ fontSize: isStory ? 40 : 26, fontWeight: 700, lineHeight: 1.2 }}>
            Dead by Daylight
          </div>
          <div style={{ fontSize: isStory ? 26 : 16, fontWeight: 600, color: accent }}>
            {roleName} · {perks.length}{" "}
            {language === "ru"
              ? ruPlural(perks.length, "перк", "перка", "перков")
              : "perks"}
          </div>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${columns}, 1fr)`,
          gap: isStory ? 28 : 20,
        }}
      >
        {perks.map((perk) => (
          <div
            key={perk.slug}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: isStory ? 18 : 12,
              padding: isStory ? 32 : 20,
              background: SURFACE,
              border: `1px solid ${BORDER}`,
              borderRadius: isStory ? 26 : 18,
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- captured by html2canvas, not rendered as a normal page image */}
            <img
              src={withBasePath(perk.icon)}
              alt={perk.name[language]}
              width={iconSize}
              height={iconSize}
              style={{
                width: iconSize,
                height: iconSize,
                borderRadius: isStory ? 20 : 14,
                display: "block",
                objectFit: "cover",
              }}
            />
            <div
              style={{
                fontSize: isStory ? 22 : 15,
                fontWeight: 600,
                textAlign: "center",
                lineHeight: 1.3,
              }}
            >
              {perk.name[language]}
            </div>
          </div>
        ))}
      </div>

      <div
        style={{
          paddingTop: isStory ? 32 : 20,
          borderTop: `1px solid ${BORDER}`,
          textAlign: "center",
          fontSize: isStory ? 18 : 13,
          color: MUTED,
        }}
      >
        DBD Perk Randomizer by flexeykinDev
      </div>
    </div>
  );
}
