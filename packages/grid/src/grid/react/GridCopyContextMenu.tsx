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
};

export function GridCopyContextMenu({ children }: GridCopyContextMenuProps) {
  const runtime = useGridRuntime();
  const targetRef = useRef<GridCopyTarget | null>(null);
  const [hasCopyTarget, setHasCopyTarget] = useState(false);

  function prepareTarget(eventTarget: EventTarget | null): void {
    const target = prepareGridCopyTarget(runtime, eventTarget);
    targetRef.current = target;
    setHasCopyTarget(target !== null);
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

  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={<div data-grid-copy-menu-scope="true" />}
        onContextMenu={(event) => {
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
      </ContextMenuContent>
    </ContextMenu>
  );
}
