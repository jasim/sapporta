import { useRef, useState, type MouseEvent, type ReactNode } from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@sapporta/ui/context-menu";
import { serializeGridCopyTargetToCsv, type GridCopyTarget } from "../copy";
import { prepareGridCopyTarget } from "../copy/target";
import { useGridRuntime } from "./GridRuntimeProvider";

export type GridCopyContextMenuProps = {
  children: ReactNode;
};

export function GridCopyContextMenu({ children }: GridCopyContextMenuProps) {
  const runtime = useGridRuntime();
  const targetRef = useRef<GridCopyTarget | null>(null);
  const [hasCopyTarget, setHasCopyTarget] = useState(false);

  function prepareTarget(event: MouseEvent<HTMLDivElement>): void {
    const target = prepareGridCopyTarget(runtime, event.target);
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
      <ContextMenuTrigger asChild onContextMenuCapture={prepareTarget}>
        <div data-grid-copy-menu-scope="true">{children}</div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem
          disabled={!hasCopyTarget}
          onSelect={() => void copy(false)}
        >
          Copy
        </ContextMenuItem>
        <ContextMenuItem
          disabled={!hasCopyTarget}
          onSelect={() => void copy(true)}
        >
          Copy with headers
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
