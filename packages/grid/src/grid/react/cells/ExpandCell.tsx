import { ChevronDown, ChevronRight } from "lucide-react";
import { useSyncExternalStore, type MouseEvent, type ReactNode } from "react";
import type { GridPath } from "../../types/identity";
import type { LevelRow } from "../../types/level-row";
import { capabilitiesFor } from "../../types/capabilities";
import { useGridRuntime } from "../GridRuntimeProvider";

// Building block for expandable hierarchies. Consumers wrap their cell
// content with <ExpandCell> when this row should host the expand chevron.
//
// The chevron renders iff capabilitiesFor(row.kind).canExpand AND the current
// level declares child levels. Toggling fires
// coordinator.toggleExpand(path, row.id).
export function ExpandCell({
  row,
  path,
  children,
}: {
  row: LevelRow;
  path: GridPath;
  children?: ReactNode;
}) {
  const runtime = useGridRuntime();
  const isExpanded = useSyncExternalStore(
    runtime.coordinator.subscribe,
    () =>
      runtime.coordinator.getState().expansion.get(path)?.has(row.id) ?? false,
    () =>
      runtime.coordinator.getState().expansion.get(path)?.has(row.id) ?? false,
  );

  const caps = capabilitiesFor(row.kind);
  const hasDeclaredChildren = runtime.schemaAt(path).childLevels.length > 0;
  const showChevron =
    caps.canExpand && row.kind === "data" && hasDeclaredChildren;

  function toggle(e: MouseEvent) {
    e.stopPropagation();
    runtime.coordinator.toggleExpand(path, row.id);
  }

  const actionLabel = isExpanded ? "Collapse row" : "Expand row";

  return (
    <span
      data-grid-part="expand-cell"
      data-expandable={showChevron ? "true" : undefined}
      data-expanded={showChevron ? String(isExpanded) : undefined}
    >
      {showChevron ? (
        <button
          type="button"
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onClick={toggle}
          aria-label={actionLabel}
          aria-expanded={isExpanded}
          data-grid-part="expand-chevron"
          title={actionLabel}
        >
          {isExpanded ? (
            <ChevronDown aria-hidden="true" size={14} strokeWidth={1.75} />
          ) : (
            <ChevronRight aria-hidden="true" size={14} strokeWidth={1.75} />
          )}
        </button>
      ) : (
        <span data-grid-part="expand-placeholder" />
      )}
      <span data-grid-part="expand-content">{children}</span>
    </span>
  );
}
