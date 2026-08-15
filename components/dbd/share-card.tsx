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

export function ShareCard({
  ref,
  perks,
  role,
  language,
}: {
  ref?: Ref<HTMLDivElement>;
  perks: Perk[];
  role: PerkRole;
  language: "en" | "ru";
}) {
  const accent = ROLE_COLOR[role].solid;
  const roleName = ROLE_LABEL[role][language];
  const columns = Math.max(perks.length, 1);

  return (
    <div
      ref={ref}
      style={{
        width: 900,
        display: "flex",
        flexDirection: "column",
        gap: 32,
        padding: 48,
        background: BACKGROUND,
        color: FOREGROUND,
        fontFamily: "Arial, Helvetica, sans-serif",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <div
          style={{
            display: "flex",
            width: 56,
            height: 56,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 14,
            background: SURFACE,
            border: `1px solid ${BORDER}`,
          }}
        >
          <div style={{ width: 26, height: 26, borderRadius: 8, border: `3px solid ${accent}` }} />
        </div>
        <div>
          <div style={{ fontSize: 26, fontWeight: 700, lineHeight: 1.2 }}>Dead by Daylight</div>
          <div style={{ fontSize: 16, fontWeight: 600, color: accent }}>
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
          gap: 20,
        }}
      >
        {perks.map((perk) => (
          <div
            key={perk.slug}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 12,
              padding: 20,
              background: SURFACE,
              border: `1px solid ${BORDER}`,
              borderRadius: 18,
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- captured by html2canvas, not rendered as a normal page image */}
            <img
              src={withBasePath(perk.icon)}
              alt={perk.name[language]}
              width={112}
              height={112}
              style={{ borderRadius: 14, display: "block" }}
            />
            <div style={{ fontSize: 15, fontWeight: 600, textAlign: "center", lineHeight: 1.3 }}>
              {perk.name[language]}
            </div>
          </div>
        ))}
      </div>

      <div
        style={{
          paddingTop: 20,
          borderTop: `1px solid ${BORDER}`,
          textAlign: "center",
          fontSize: 13,
          color: MUTED,
        }}
      >
        DBD Perk Randomizer by flexeykinDev
      </div>
    </div>
  );
}
