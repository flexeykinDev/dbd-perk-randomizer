import { ImageResponse } from "next/og";

export const dynamic = "force-static";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 36,
          background: "#0b0c0f",
          color: "#edeef0",
          fontFamily: "sans-serif",
        }}
      >
        <svg width="140" height="140" viewBox="0 0 64 64">
          <rect width="64" height="64" rx="14" fill="#14161b" />
          <rect x="14" y="14" width="36" height="36" rx="8" fill="none" stroke="#f59e0b" strokeWidth="4" />
          <circle cx="24" cy="24" r="3.4" fill="#f59e0b" />
          <circle cx="40" cy="24" r="3.4" fill="#f59e0b" />
          <circle cx="32" cy="32" r="3.4" fill="#f59e0b" />
          <circle cx="24" cy="40" r="3.4" fill="#f59e0b" />
          <circle cx="40" cy="40" r="3.4" fill="#f59e0b" />
        </svg>
        <div style={{ fontSize: 68, fontWeight: 700 }}>DBD Perk Randomizer</div>
        <div style={{ fontSize: 32, color: "#9096a3" }}>
          Актуальный список перков прямо с официальной wiki
        </div>
      </div>
    ),
    { ...size },
  );
}
