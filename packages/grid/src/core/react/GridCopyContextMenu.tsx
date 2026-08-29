import { useRef, useState, type ReactNode } from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@sapporta/ui/context-menu";
import { serializeGridCopyTargetToCsv, type GridCopyTarget } from "../copy";
import { prepareGridCopyTarget } from "../copy/target";
import { useGridRuntime } from "./GridRuntimeProvider";
import { eventTargetIsWithin } from "./internal/dom-targets";

export type GridCopyContextMenuProps = {
  children: ReactNode;
  /**
   * Domain-supplied menu entries appended after the copy items. Receives the
   * grid target the menu was opened on (null outside cells). Consumers use
   * this for schema-derived contributions such as row and cell links; the
   * grid itself stays domain-agnostic.
   */
  renderExtraItems?: (target: GridCopyTarget | null) => ReactNode;
};

export function GridCopyContextMenu({
  children,
  renderExtraItems,
}: GridCopyContextMenuProps) {
  const runtime = useGridRuntime();
  const targetRef = useRef<GridCopyTarget | null>(null);
  const [menuTarget, setMenuTarget] = useState<GridCopyTarget | null>(null);
  const hasCopyTarget = menuTarget !== null;

  function prepareTarget(eventTarget: EventTarget | null): void {
    const target = prepareGridCopyTarget(runtime, eventTarget);
    targetRef.current = target;
    setMenuTarget(target);
  }

  async function copy(includeHeaders: boolean): Promise<void> {
    const target = targetRef.current;
    if (!target) return;
    const csv = await serializeGridCopyTargetToCsv(runtime, target, {
      includeHeaders,
    });
    if (csv == null) return;
    void navigator.clipboard.writeText(csv).catch(() => {});
  }

  // A phone or tablet, as opposed to a touchscreen laptop.
  function touchIsPrimaryPointer(): boolean {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia("(hover: none) and (pointer: coarse)").matches;
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={<div data-grid-copy-menu-scope="true" />}
        onContextMenu={(event) => {
          if (touchIsPrimaryPointer()) {
            // No copy menu on touch: its open/close race with the synthesized
            // compat events leaves it stuck half-transparent.
            event.preventBaseUIHandler();
            return;
          }
          if (!eventTargetIsWithin(event.target, event.currentTarget)) {
            // Without this check, right-clicking a dialog opened from the grid
            // also opens the grid's Copy menu. Stop only the grid menu trigger.
            // The dialog and the browser still handle the right-click normally.
            event.preventBaseUIHandler();
            return;
          }
          prepareTarget(event.target);
        }}
        onTouchStart={(event) => {
          if (touchIsPrimaryPointer()) {
            // Suppress the long-press-to-open timer; see onContextMenu.
            event.preventBaseUIHandler();
            return;
          }
          if (!eventTargetIsWithin(event.target, event.currentTarget)) {
            // A long press inside a dialog opened from the grid must not start
            // the grid's context-menu timer.
            event.preventBaseUIHandler();
            return;
          }
          prepareTarget(event.target);
        }}
      >
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem
          disabled={!hasCopyTarget}
          onClick={() => void copy(false)}
        >
          Copy
        </ContextMenuItem>
        <ContextMenuItem
          disabled={!hasCopyTarget}
          onClick={() => void copy(true)}
        >
          Copy with headers
        </ContextMenuItem>
        {renderExtraItems?.(menuTarget)}
      </ContextMenuContent>
    </ContextMenu>
  );
}
