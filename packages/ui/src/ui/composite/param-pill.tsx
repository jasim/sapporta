import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../utils/cn";

export interface ParamPillProps {
  /** Left cap — dim label (e.g., "account", "period"). */
  label: ReactNode;
  /** Middle cell — the current value, rendered in fg. Monospace when `mono`. */
  value: ReactNode;
  /** Mono the value cell (for identifiers and dates). Default false. */
  mono?: boolean;
  /** Click opens an editor / picker. If omitted, the pill is static. */
  onClick?: () => void;
  /** Show the trailing chevron "▾". Default true when onClick is provided. */
  dropdown?: boolean;
  /** Replaces the automatic chevron affordance — e.g., a clear ✕. */
  trailing?: ReactNode;
  /** True when the pill is the currently open one in a popover dance. */
  active?: boolean;
  /** Adds a small colored dot before the label (e.g., status indicator). */
  dot?: string;
  className?: string;
}

/** Segmented [ label | value | chevron ] pill.
 *
 *  The target's parameter / facet bar uses a pill with three visual cells
 *  separated by hairlines: a dim "label" cap, the "value", and a dropdown
 *  chevron. We use it for report params and table filters — any place the
 *  UI says "here is a dimension that's been set to a value you can change".
 *  Height tracks the bar tier (24px). The label cell picks up a slightly
 *  warmer tint (`bg-sap-proj-chip-kbd`) so the eye reads the three regions at
 *  a glance. */
export function ParamPill({
  label,
  value,
  mono = false,
  onClick,
  dropdown,
  trailing,
  active = false,
  dot,
  className,
}: ParamPillProps) {
  const showChevron = trailing == null && (dropdown ?? onClick != null);
  const isInteractive = onClick != null;

  const Wrapper: "button" | "div" = isInteractive ? "button" : "div";
  const borderColor = active ? "border-sap-brand" : "border-sap-border";

  return (
    <Wrapper
      type={isInteractive ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "inline-flex items-stretch h-sap-bar rounded-[5px] overflow-hidden border bg-sap-surface text-sap-data",
        borderColor,
        isInteractive && "hover:bg-sap-row-hover transition-colors cursor-pointer",
        className,
      )}
    >
      <span
        className={cn(
          "flex items-center gap-[6px] px-[8px] border-r bg-sap-proj-chip-kbd text-sap-subtle",
          borderColor,
        )}
      >
        {dot && (
          <span
            className="w-[6px] h-[6px] rounded-full shrink-0"
            style={{ background: dot }}
          />
        )}
        {label}
      </span>

      <span
        className={cn(
          "flex items-center px-[8px] max-w-[30ch] truncate",
          mono && "mono",
          active ? "text-sap-brand" : "text-sap-fg",
        )}
      >
        {value}
      </span>

      {trailing != null && (
        <span
          className={cn(
            "flex items-center px-[6px] border-l text-sap-subtle",
            borderColor,
          )}
        >
          {trailing}
        </span>
      )}

      {showChevron && (
        <span
          className={cn(
            "flex items-center px-[6px] border-l text-sap-subtle",
            borderColor,
          )}
        >
          <ChevronDown className="h-[10px] w-[10px]" strokeWidth={2} />
        </span>
      )}
    </Wrapper>
  );
}
