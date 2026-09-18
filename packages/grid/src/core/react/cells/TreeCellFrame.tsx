import { ChevronDown, ChevronRight } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { treeFactsOf, type LevelRow } from "../../types/level-row";
import type {
  CellActivation,
  CellActivationGesture,
  CellRenderActivation,
  ColumnSchema,
} from "../../types/schema";
import { CellActivationButton } from "./CellActivationButton";

// The tree column of a tree level (`LevelSchema.tree`) shows where a row sits
// in the tree: indentation for its depth, then a chevron when it has children,
// then the column's own content. A row without children keeps the chevron's
// space, so names at the same depth line up.

/**
 * The cell action that expands and collapses a tree row. Space runs it; Enter
 * runs it on a cell that cannot be edited. Pointer expansion belongs to the
 * chevron button, so a click on the rest of the cell focuses, selects, or
 * edits as usual.
 */
export function treeExpansionActivation(options?: {
  startsOn?: readonly CellActivationGesture[];
}): CellActivation {
  return {
    startsOn: options?.startsOn ?? ["enter", "space"],
    describe: ({ path, row, actions }) => {
      if (!actions.treeExpansion.canToggle({ path, row })) {
        return { label: "Row", availability: { kind: "disabled" } };
      }
      return {
        label: actions.treeExpansion.isExpanded({ path, rowId: row.id })
          ? "Collapse row"
          : "Expand row",
        availability: { kind: "enabled" },
      };
    },
    run: ({ path, row, actions }) => {
      actions.treeExpansion.toggle({ path, rowId: row.id });
    },
  };
}

export function TreeCellFrame({
  activation,
  row,
  indentStep,
  children,
}: {
  activation: CellRenderActivation | null;
  row: LevelRow;
  /** Width of one level of indentation, such as `"18px"`. */
  indentStep?: string;
  children?: ReactNode;
}) {
  const tree = treeFactsOf(row);
  const depth = tree?.depth ?? 0;
  const expanded = tree?.expanded ?? false;
  const expandable =
    (tree?.childCount ?? 0) > 0 && activation?.availability.kind === "enabled";
  const style = {
    "--grid-tree-depth": depth,
    ...(indentStep ? { "--grid-tree-indent": indentStep } : {}),
  } as CSSProperties;

  return (
    <span
      data-grid-part="tree-cell"
      data-tree-depth={depth}
      data-expandable={expandable ? "true" : undefined}
      data-expanded={expandable ? String(expanded) : undefined}
      style={style}
    >
      {expandable && activation ? (
        <CellActivationButton activation={activation} gridPart="tree-chevron">
          {expanded ? (
            <ChevronDown aria-hidden="true" size={14} strokeWidth={1.75} />
          ) : (
            <ChevronRight aria-hidden="true" size={14} strokeWidth={1.75} />
          )}
        </CellActivationButton>
      ) : (
        <span data-grid-part="tree-placeholder" aria-hidden="true" />
      )}
      <span data-grid-part="tree-content">{children}</span>
    </span>
  );
}

export type TreeColumnOptions = {
  activation?: CellActivation;
  /** Width of one level of indentation, such as `"18px"`. */
  indentStep?: string;
};

/**
 * Makes a column the tree column of a tree level: it draws indentation and
 * the expand control, and Space expands or collapses the row.
 */
export function withTreeColumn(
  column: ColumnSchema,
  options: TreeColumnOptions = {},
): ColumnSchema {
  const renderCell = column.renderCell;
  const activation = options.activation ?? treeExpansionActivation();
  // Edit gestures stay: Enter edits a writable cell and otherwise expands or
  // collapses, while Space always expands or collapses.
  return {
    ...column,
    activation,
    renderCell: (props) => (
      <TreeCellFrame
        activation={props.activation}
        row={props.row}
        indentStep={options.indentStep}
      >
        {renderCell(props)}
      </TreeCellFrame>
    ),
  };
}
