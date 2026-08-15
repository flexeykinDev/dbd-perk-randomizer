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
// never touches a Tailwind class or CSS custom property. Gradients use the
// same literal-color rule and stick to plain linear-/radial-gradient syntax
// html2canvas has supported for years (this isn't the oklch problem).
const SURFACE = "#1e2228";
const SURFACE_LIGHT = "#262b33";
const BORDER = "rgba(255,255,255,0.08)";
const FOREGROUND = "#edeef0";
const MUTED = "#9096a3";

const ROLE_LABEL: Record<PerkRole, { ru: string; en: string }> = {
  survivor: { ru: "Выживший", en: "Survivor" },
  killer: { ru: "Убийца", en: "Killer" },
};

export type ShareCardLayout = "landscape" | "story";

// Real, fixed canvas dimensions instead of "however tall the content turns
// out to be" — landscape is now a genuine 16:9 (what Discord/X crop link
// previews to), matching the story format's already-fixed 1080x1920.
const CANVAS_SIZE: Record<ShareCardLayout, { width: number; height: number }> = {
  landscape: { width: 1600, height: 900 },
  story: { width: 1080, height: 1920 },
};

// Perk icons are scraped/stored at a native 128x128 (see
// scripts/scrape-perks.ts) — displaying them larger than that upscales a
// fixed-detail bitmap, which is what actually caused the "blurry export"
// complaint (no html2canvas `scale` setting can add detail that isn't in
// the source file). These stay close enough to 128 that the stretch is
// imperceptible; card size instead comes from padding/gaps/typography,
// which are vector/text and render crisply at any size.
const ICON_SIZE: Record<ShareCardLayout, number> = {
  landscape: 132,
  story: 160,
};

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
  /** "landscape" (default): fixed 1600x900 (16:9) — used for the regular
   *  "Download Image" option. "story": fixed 1080x1920 (9:16), for
   *  Instagram/TikTok Stories. */
  layout?: ShareCardLayout;
}) {
  const accent = ROLE_COLOR[role].solid;
  const roleName = ROLE_LABEL[role][language];
  const isStory = layout === "story";
  const columns = isStory ? Math.min(Math.max(perks.length, 1), 2) : Math.max(perks.length, 1);
  const iconSize = ICON_SIZE[layout];
  const { width, height } = CANVAS_SIZE[layout];
  const padding = isStory ? 64 : 56;
  const blockGap = isStory ? 72 : 40;

  return (
    <div
      ref={ref}
      style={{
        width,
        height,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        gap: blockGap,
        padding,
        // A flat single color read as sterile at this size — a soft,
        // role-tinted glow from the top plus a vertical gradient gives the
        // export some depth without depending on anything html2canvas
        // renders unreliably (no blur filters, no oklch).
        background: `radial-gradient(ellipse 120% 55% at 50% 0%, ${accent}26, transparent 65%), linear-gradient(180deg, #181b22 0%, #0d0e12 100%)`,
        color: FOREGROUND,
        fontFamily: "Arial, Helvetica, sans-serif",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: isStory ? "column" : "row",
          alignItems: "center",
          gap: isStory ? 22 : 18,
        }}
      >
        <div
          style={{
            display: "flex",
            width: isStory ? 100 : 64,
            height: isStory ? 100 : 64,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: isStory ? 24 : 16,
            background: `linear-gradient(180deg, ${SURFACE_LIGHT} 0%, ${SURFACE} 100%)`,
            border: `1px solid ${BORDER}`,
          }}
        >
          <div
            style={{
              width: isStory ? 44 : 30,
              height: isStory ? 44 : 30,
              borderRadius: isStory ? 13 : 9,
              border: `${isStory ? 4 : 3}px solid ${accent}`,
            }}
          />
        </div>
        <div style={{ textAlign: isStory ? "center" : "left" }}>
          <div style={{ fontSize: isStory ? 46 : 30, fontWeight: 700, lineHeight: 1.2 }}>
            Dead by Daylight
          </div>
          <div style={{ fontSize: isStory ? 30 : 19, fontWeight: 600, color: accent }}>
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
          gridTemplateColumns: isStory
            ? `repeat(${columns}, 1fr)`
            : `repeat(${columns}, minmax(0, 300px))`,
          justifyContent: isStory ? "stretch" : "center",
          gap: isStory ? 44 : 28,
        }}
      >
        {perks.map((perk) => (
          <div
            key={perk.slug}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: isStory ? 22 : 16,
              padding: isStory ? 48 : 36,
              background: `linear-gradient(180deg, ${SURFACE_LIGHT} 0%, ${SURFACE} 100%)`,
              border: `1px solid ${BORDER}`,
              borderRadius: isStory ? 28 : 20,
              boxShadow: "0 10px 26px rgba(0,0,0,0.35)",
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
                fontSize: isStory ? 26 : 19,
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
          paddingTop: isStory ? 36 : 24,
          borderTop: `1px solid ${BORDER}`,
          textAlign: "center",
          fontSize: isStory ? 20 : 14,
          color: MUTED,
        }}
      >
        DBD Perk Randomizer by flexeykinDev
      </div>
    </div>
  );
}
