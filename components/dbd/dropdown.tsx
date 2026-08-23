"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";

/* The site's dropdown, replacing the four native `<select>`s.
 *
 * A native select cannot be styled where it matters: the popup itself is drawn
 * by the operating system, so on a dark page it opened as a white Windows menu
 * with system-blue highlights, in a font nothing else on the site uses. Every
 * other control here is a rounded, bordered, token-coloured thing; the selects
 * were the one place that stopped looking like the same product.
 *
 * Two things are worth knowing about how it is built:
 *
 * The panel is portalled to the body and positioned fixed. Three of the four
 * selects live inside modals that scroll their own content, and an absolutely
 * positioned panel is clipped by `overflow-y: auto` on an ancestor — the
 * bottom half of the list would simply be cut off. A native select never had
 * that problem because the OS drew it outside the page entirely, so matching
 * that behaviour is the price of replacing it.
 *
 * It flips above the trigger when there is not enough room below, which is the
 * common case for a control near the bottom of a modal.
 */

export interface DropdownOption<T extends string> {
  value: T;
  label: string;
  /** Second line, for options whose name does not explain them. */
  hint?: string;
  /** Shown right-aligned — how many things this option matches. */
  count?: number;
  disabled?: boolean;
}

interface PanelPosition {
  left: number;
  top: number;
  width: number;
  /** Set when the panel opens upward, so it can be bottom-anchored. */
  maxHeight: number;
}

const PANEL_GAP = 6;
const MIN_PANEL_HEIGHT = 160;

/** Where the panel goes, in viewport coordinates. */
function positionFor(trigger: DOMRect): PanelPosition & { above: boolean } {
  const below = window.innerHeight - trigger.bottom - PANEL_GAP;
  const above = trigger.top - PANEL_GAP;
  // Flip only when below genuinely cannot hold a usable list — a panel that
  // jumps upward for the sake of 20 extra pixels is more disorienting than a
  // slightly short list.
  const flip = below < MIN_PANEL_HEIGHT && above > below;
  const width = Math.max(trigger.width, 176);
  return {
    above: flip,
    left: Math.min(Math.max(8, trigger.left), Math.max(8, window.innerWidth - width - 8)),
    top: flip ? trigger.top - PANEL_GAP : trigger.bottom + PANEL_GAP,
    width,
    maxHeight: Math.min(320, Math.max(MIN_PANEL_HEIGHT, flip ? above : below)),
  };
}

function useDropdown(open: boolean, onClose: () => void) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<(PanelPosition & { above: boolean }) | null>(null);

  const measure = useCallback(() => {
    const el = triggerRef.current;
    if (el) setPos(positionFor(el.getBoundingClientRect()));
  }, []);

  // Before paint, so the panel never renders at a stale position for a frame.
  useLayoutEffect(() => {
    if (open) measure();
  }, [open, measure]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!panelRef.current?.contains(target) && !triggerRef.current?.contains(target)) onClose();
    };
    // Capture: an ancestor that scrolls does not bubble its scroll event, and
    // the panel is fixed, so without this it would hang in mid-air.
    const onScroll = () => measure();
    /* Escape has to be caught on `window`, in the capture phase.
     *
     * The modals these sit inside listen for Escape on `document` with
     * capture (lib/use-modal.ts), which runs before anything in the React
     * tree — so one press closed the dropdown AND the panel behind it,
     * throwing away the filter someone was halfway through setting. Capture
     * order is window, then document, so this is the only place that gets
     * there first. */
    const onEscape = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      e.preventDefault();
      onClose();
      triggerRef.current?.focus();
    };
    window.addEventListener("keydown", onEscape, true);
    document.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("keydown", onEscape, true);
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open, onClose, measure]);

  return { triggerRef, panelRef, pos };
}

const TRIGGER_CLASS =
  "tap flex items-center justify-between gap-1.5 rounded-full border transition-colors focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none";

function Panel({
  panelRef,
  pos,
  labelledBy,
  multiple,
  children,
  onKeyDown,
}: {
  panelRef: React.RefObject<HTMLDivElement | null>;
  pos: (PanelPosition & { above: boolean }) | null;
  labelledBy?: string;
  multiple: boolean;
  children: React.ReactNode;
  onKeyDown: (e: React.KeyboardEvent) => void;
}) {
  if (typeof document === "undefined" || !pos) return null;
  return createPortal(
    <div
      ref={panelRef}
      role="listbox"
      aria-multiselectable={multiple || undefined}
      aria-label={labelledBy}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      style={{
        position: "fixed",
        left: pos.left,
        width: pos.width,
        maxHeight: pos.maxHeight,
        ...(pos.above ? { bottom: window.innerHeight - pos.top } : { top: pos.top }),
      }}
      className="z-[60] overflow-y-auto overscroll-contain rounded-2xl border border-border bg-surface p-1.5 shadow-xl"
    >
      {children}
    </div>,
    document.body,
  );
}

function Option({
  option,
  selected,
  active,
  multiple,
  onPick,
  id,
}: {
  option: DropdownOption<string>;
  selected: boolean;
  active: boolean;
  multiple: boolean;
  onPick: () => void;
  id: string;
}) {
  return (
    <button
      id={id}
      type="button"
      role="option"
      aria-selected={selected}
      disabled={option.disabled}
      onClick={onPick}
      className={cn(
        "flex w-full items-start gap-2 rounded-xl px-2.5 py-1.5 text-left transition-colors",
        option.disabled ? "cursor-not-allowed opacity-45" : "hover:bg-surface-hover",
        active && "bg-surface-hover",
      )}
    >
      <span
        className={cn(
          "mt-0.5 flex size-3.5 shrink-0 items-center justify-center",
          multiple && "rounded border border-border",
          multiple && selected && "border-accent bg-accent/20",
        )}
      >
        <Check className={cn("size-3", selected ? "text-accent" : "opacity-0")} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium text-foreground">{option.label}</span>
        {option.hint && (
          <span className="block text-[0.625rem] leading-snug text-muted">{option.hint}</span>
        )}
      </span>
      {option.count !== undefined && (
        <span className="mt-0.5 shrink-0 text-[0.625rem] tabular-nums text-muted">
          {option.count}
        </span>
      )}
    </button>
  );
}

/** Arrow-key navigation shared by both variants. Returns the key handler and
 *  the index the list should highlight. */
function useRoving(
  options: DropdownOption<string>[],
  open: boolean,
  onPick: (index: number) => void,
  onClose: () => void,
) {
  const [active, setActive] = useState(0);
  // Named for the same reason as the restores in lib/ — see use-obs-hold.ts:
  // the compiler's lint rejects a bare setState in an effect body.
  useEffect(() => {
    function highlightFirstOption() {
      setActive(0);
    }
    if (open) highlightFirstOption();
  }, [open]);

  const step = (from: number, dir: 1 | -1) => {
    for (let i = 1; i <= options.length; i++) {
      const next = (from + dir * i + options.length * i) % options.length;
      if (!options[next]?.disabled) return next;
    }
    return from;
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => step(i, e.key === "ArrowDown" ? 1 : -1));
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      setActive(e.key === "Home" ? step(-1, 1) : step(0, -1));
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (!options[active]?.disabled) onPick(active);
    } else if (e.key === "Escape" || e.key === "Tab") {
      // Three of these live inside modals that close on Escape from a
      // document-level listener, so without this one press shut the dropdown
      // AND the panel behind it — losing the filter someone was in the middle
      // of setting.
      if (e.key === "Escape") e.stopPropagation();
      onClose();
    }
  };

  return { active, onKeyDown };
}

/** One choice. The direct replacement for a single-value `<select>`. */
export function Dropdown<T extends string>({
  value,
  options,
  onChange,
  label,
  icon,
  placeholder,
  className,
  testId,
}: {
  value: T;
  options: DropdownOption<T>[];
  onChange: (value: T) => void;
  /** Accessible name — these sit next to a text label, not a `<label for>`. */
  label: string;
  icon?: React.ReactNode;
  placeholder?: string;
  className?: string;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const { triggerRef, panelRef, pos } = useDropdown(open, close);
  const listId = useId();

  const pick = (index: number) => {
    const option = options[index];
    if (!option) return;
    onChange(option.value);
    setOpen(false);
    triggerRef.current?.focus();
  };
  const { active, onKeyDown } = useRoving(options, open, pick, () => {
    setOpen(false);
    triggerRef.current?.focus();
  });

  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open, pos, panelRef]);

  const current = options.find((o) => o.value === value);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        data-testid={testId}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className={cn(TRIGGER_CLASS, "px-3 py-1.5 text-xs", className)}
      >
        {icon}
        <span className="truncate">{current?.label ?? placeholder ?? label}</span>
        <ChevronDown className={cn("size-3.5 shrink-0 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <Panel panelRef={panelRef} pos={pos} labelledBy={label} multiple={false} onKeyDown={onKeyDown}>
          {options.map((option, i) => (
            <Option
              key={option.value}
              id={`${listId}-${i}`}
              option={option}
              selected={option.value === value}
              active={i === active}
              multiple={false}
              onPick={() => pick(i)}
            />
          ))}
        </Panel>
      )}
    </>
  );
}

/** Several choices at once. Stays open while picking, because the whole point
 *  is choosing more than one thing without reopening the list each time. */
export function MultiDropdown<T extends string>({
  values,
  options,
  onChange,
  label,
  icon,
  /** Shown on the trigger when nothing is selected. */
  placeholder,
  /** Builds the trigger text for a selection, e.g. "3 characters". */
  summary,
  className,
  testId,
}: {
  values: T[];
  options: DropdownOption<T>[];
  onChange: (values: T[]) => void;
  label: string;
  icon?: React.ReactNode;
  placeholder: string;
  summary: (count: number) => string;
  className?: string;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const { triggerRef, panelRef, pos } = useDropdown(open, close);
  const listId = useId();
  const selected = new Set<string>(values);

  const toggle = (index: number) => {
    const option = options[index];
    if (!option) return;
    onChange(
      selected.has(option.value)
        ? values.filter((v) => v !== option.value)
        : [...values, option.value],
    );
  };
  const { active, onKeyDown } = useRoving(options, open, toggle, () => {
    setOpen(false);
    triggerRef.current?.focus();
  });

  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open, pos, panelRef]);

  const chosen = options.filter((o) => selected.has(o.value));
  const triggerText =
    chosen.length === 0 ? placeholder : chosen.length === 1 ? chosen[0].label : summary(chosen.length);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        data-testid={testId}
        data-selected-count={chosen.length}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className={cn(TRIGGER_CLASS, "px-3 py-1.5 text-xs", className)}
      >
        {icon}
        <span className="truncate">{triggerText}</span>
        <ChevronDown className={cn("size-3.5 shrink-0 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <Panel panelRef={panelRef} pos={pos} labelledBy={label} multiple onKeyDown={onKeyDown}>
          {options.map((option, i) => (
            <Option
              key={option.value}
              id={`${listId}-${i}`}
              option={option}
              selected={selected.has(option.value)}
              active={i === active}
              multiple
              onPick={() => toggle(i)}
            />
          ))}
        </Panel>
      )}
    </>
  );
}
