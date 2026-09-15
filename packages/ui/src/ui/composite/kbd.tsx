import type { ReactNode } from "react";
import { cn } from "../utils/cn";

/** Keyboard-shortcut chip. Two visual variants match the template:
 *
 *   - framed (default): 1px border, surface bg, subtle text — pairs with
 *     ghost buttons and sidebar chrome.
 *   - inverted: translucent wash (`bg-sap-kbd-inverted`) with inherited
 *     color — sits inside solid-dark buttons (e.g. a primary "New record ⌘N").
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
        "mono text-sap-label font-normal rounded-sm px-[5px] py-[1px] inline-flex items-center justify-center",
        variant === "framed"
          ? "border border-sap-border bg-sap-kbd text-sap-subtle"
          : "bg-sap-kbd-inverted text-primary-foreground",
        className,
      )}
    >
      {children}
    </kbd>
  );
}
