import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Keyboard-shortcut chip. Two visual variants match the template:
 *
 *   - framed (default): 1px border, surface bg, subtle text — pairs with
 *     ghost buttons and sidebar chrome.
 *   - inverted: translucent-white wash with inherited color — sits inside
 *     solid-dark buttons (e.g. a primary "New record ⌘N").
 *
 *  Mono 10.5px with tight padding so it reads as metadata, not a control. */
export function Kbd({
  children,
  variant = "framed",
  className,
}: {
  children: ReactNode;
  variant?: "framed" | "inverted";
  className?: string;
}) {
  return (
    <kbd
      className={cn(
        "mono text-sap-label font-normal rounded-[3px] px-[5px] py-[1px] inline-flex items-center justify-center",
        variant === "framed"
          ? "border border-sap-border bg-sap-kbd text-sap-subtle"
          : "bg-white/15 text-primary-foreground",
        className,
      )}
    >
      {children}
    </kbd>
  );
}
