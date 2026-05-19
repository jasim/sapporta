import { useStore } from "zustand";
import type { ReactNode } from "react";
import type { GridPath, RowId } from "../../types/identity";
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
  const isExpanded = useStore(
    runtime.coordinator,
    (s) => s.expansion.get(path)?.has(row.id as RowId) ?? false,
  );

  const caps = capabilitiesFor(row.kind);
  const hasDeclaredChildren =
    runtime.schemaAt(path).childLevels.length > 0;
  const showChevron =
    caps.canExpand && row.kind === "data" && hasDeclaredChildren;

  function toggle(e: React.MouseEvent) {
    e.stopPropagation();
    runtime.coordinator.toggleExpand(path, row.id);
  }

  return (
    <span
      className="grid-expand-cell"
      style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
    >
      {showChevron ? (
        <button
          type="button"
          onClick={toggle}
          aria-label={isExpanded ? "Collapse" : "Expand"}
          aria-expanded={isExpanded}
          className="grid-expand-chevron"
          style={{
            width: 16,
            height: 16,
            padding: 0,
            border: 0,
            background: "transparent",
            cursor: "pointer",
          }}
        >
          {isExpanded ? "▾" : "▸"}
        </button>
      ) : (
        <span style={{ display: "inline-block", width: 16 }} />
      )}
      <span>{children}</span>
    </span>
  );
}
