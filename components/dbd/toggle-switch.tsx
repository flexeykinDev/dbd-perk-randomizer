"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";

export function ToggleSwitch({
  checked,
  onChange,
  label,
  tooltip,
  activeClassName,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
  tooltip?: string;
  activeClassName?: string;
}) {
  const [showTooltip, setShowTooltip] = useState(false);

  return (
    <div
      className="relative inline-flex items-center gap-2.5"
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <span className="text-sm font-semibold text-muted">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={onChange}
        // Stops a mouse click from leaving this focused (click still fires
        // normally on mouseup either way). Without this, the button keeps
        // focus after a click, so any later stray Space press — e.g. meant
        // for the page's own Space-to-reroll shortcut — silently activates
        // this button again via the browser's native space-activates-button
        // behavior, flipping the toggle a second time.
        onMouseDown={(e) => e.preventDefault()}
        className={cn(
          "relative h-6 w-11 shrink-0 rounded-full border transition-colors",
          checked
            ? cn("border-transparent", activeClassName ?? "bg-accent")
            : "border-border bg-surface-hover",
        )}
      >
        {/* The knob takes whichever token contrasts with the track it's
            sitting on, instead of being permanently white. Since the accent
            became a neutral, an always-white knob on an "on" track meant
            bone-on-bone in the dark theme (the knob simply vanished) and
            white-on-white in the light one. --accent-foreground is already
            defined as the colour that reads against --accent, so the two
            states can't drift apart. */}
        <span
          className={cn(
            "absolute top-0.5 left-0.5 size-5 rounded-full shadow transition-transform",
            checked ? "translate-x-5 bg-accent-foreground" : "bg-foreground",
          )}
        />
      </button>
      {tooltip && (
        <div
          role="tooltip"
          className={cn(
            "pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 w-max max-w-56 -translate-x-1/2 rounded-lg border border-border bg-surface px-3 py-1.5 text-center text-xs text-foreground shadow-lg transition-opacity",
            showTooltip ? "opacity-100" : "opacity-0",
          )}
        >
          {tooltip}
        </div>
      )}
    </div>
  );
}
