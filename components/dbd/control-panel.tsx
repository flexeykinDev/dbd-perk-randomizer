import type { ReactNode } from "react";

/**
 * The shell the board's control rows share.
 *
 * Two of them exist — the roll-shape panel above the build and the setup
 * panel inside the disclosure — and they were the same 200-character class
 * string written twice. It is load-bearing, not decoration: the segments
 * stack with a horizontal rule between them on a phone and sit side by side
 * with a vertical one from `sm` up, which is `divide-y` flipping to
 * `divide-x`. Change it in one place and the two panels agree; change it in
 * one of two copies and they do not, in a way nothing tests.
 *
 * `overflow-x-auto` rather than wrapping, deliberately: a divider inside a
 * `flex-wrap` row cannot know which visual line it landed on and orphans the
 * moment the row wraps.
 *
 * Which is why the row does not begin until `lg`. It used to begin at `sm`,
 * and the widest panel here — Theme beside Coherence and its helper line —
 * wants 903px. So from 640px to roughly 910px it scrolled sideways and parked
 * controls outside their own box: two of them at 640. That shipped, and the
 * guard in e2e/setup-disclosure.spec.ts caught it on CI rather than locally,
 * because the check is whether a control's rectangle falls inside the panel's
 * and Linux and Windows disagree about Cyrillic glyph widths by just enough to
 * move one across the line. A horizontal row that cannot fit is not a layout,
 * so it stacks until there is room for one.
 */
export function ControlPanel({ children }: { children: ReactNode }) {
  return (
    <div className="flex w-full max-w-full flex-col items-start divide-y divide-border overflow-x-auto rounded-2xl border border-border bg-surface/40 lg:w-auto lg:flex-row lg:items-center lg:divide-x lg:divide-y-0">
      {children}
    </div>
  );
}

/**
 * One labelled segment inside a ControlPanel: a muted caption and the controls
 * it names.
 *
 * `text-meta` on the segment is the caption's size — the controls inside set
 * their own `text-control`, because a 12px label on a button is still a
 * control. See the type scale in app/globals.css.
 */
export function ControlGroup({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex shrink-0 flex-wrap items-center justify-center gap-x-2 gap-y-1.5 px-4 py-1.5 text-meta sm:py-2">
      <span className="text-muted">{label}</span>
      {children}
    </div>
  );
}
