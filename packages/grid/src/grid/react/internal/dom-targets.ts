import type {
  CellCursor,
  ColId,
  Coord,
  GridPath,
  RowId,
} from "../../types/identity";

// Grid DOM identity supports two live concerns:
//
//   - CSS reads the stable part names and state attributes for chrome.
//   - Keyboard routing, editor positioning, scroll effects, and cursor parsing
//     read root, row, and cell identity from the same rendered elements.
//
// A concrete cell is the element with both `data-grid-part="cell"` and the
// matching column id. Cards also render field wrappers with `data-col-id`, so
// cell lookup must include the cell part marker.
const GRID_ROOT_SELECTOR = "[data-grid-path]";
const GRID_ROW_SELECTOR = '[data-grid-part="row"]';
const GRID_CELL_SELECTOR = '[data-grid-part="cell"]';

export function gridRootIdentityAttrs(path: GridPath): {
  "data-grid-part": "root";
  "data-grid-path": GridPath;
} {
  return {
    "data-grid-part": "root",
    "data-grid-path": path,
  };
}

export function gridRowIdentityAttrs(rowId: RowId): {
  "data-grid-part": "row";
  "data-row-id": RowId;
} {
  return {
    "data-grid-part": "row",
    "data-row-id": rowId,
  };
}

export function gridCellIdentityAttrs(colId: ColId): {
  "data-grid-part": "cell";
  "data-col-id": ColId;
} {
  return {
    "data-grid-part": "cell",
    "data-col-id": colId,
  };
}

export function eventBelongsToGridRoot(
  target: EventTarget | null,
  root: HTMLElement,
): boolean {
  // Native keydown events bubble through nested grids. The closest grid root
  // around the event target is the active keyboard scope for that event; every
  // ancestor grid sees the bubble and exits here.
  return elementFromEventTarget(target)?.closest(GRID_ROOT_SELECTOR) === root;
}

export function findGridRowElement(
  container: ParentNode,
  rowId: RowId,
): HTMLElement | null {
  return container.querySelector<HTMLElement>(gridRowSelector(rowId));
}

export function findGridCellElement(
  container: ParentNode,
  coord: Coord,
): HTMLElement | null {
  // Cell effects are path-local because the caller already holds the grid root.
  // Row lookup runs first so the column selector cannot match another row or a
  // card field wrapper that also carries `data-col-id`.
  return (
    findGridRowElement(container, coord.rowId)?.querySelector<HTMLElement>(
      gridCellSelector(coord.colId),
    ) ?? null
  );
}

export function cellCursorFromEventTarget(
  target: EventTarget | null,
): CellCursor | null {
  // A pointer or clipboard event can start inside renderer output. Walking up
  // to the cell, row, and root reconstructs the logical cursor without reading
  // array indexes or rendered order.
  const element = elementFromEventTarget(target);
  const cell = element?.closest<HTMLElement>(GRID_CELL_SELECTOR);
  if (!cell) return null;

  const row = cell.closest<HTMLElement>(GRID_ROW_SELECTOR);
  const root = cell.closest<HTMLElement>(GRID_ROOT_SELECTOR);
  const path = root?.getAttribute("data-grid-path");
  const rowId = row?.getAttribute("data-row-id");
  const colId = cell.getAttribute("data-col-id");
  if (!path || !rowId || !colId) return null;
  return { path: path as GridPath, rowId: rowId as RowId, colId };
}

function gridRowSelector(rowId: RowId): string {
  return `${GRID_ROW_SELECTOR}[data-row-id="${cssStringEscape(rowId)}"]`;
}

function gridCellSelector(colId: ColId): string {
  return `${GRID_CELL_SELECTOR}[data-col-id="${cssStringEscape(colId)}"]`;
}

function elementFromEventTarget(target: EventTarget | null): Element | null {
  // Some native events target text nodes. `closest` exists only on Element, and
  // text nodes use their parent element as the rendered interaction target.
  if (typeof Element !== "undefined" && target instanceof Element) {
    return target;
  }
  if (typeof Node !== "undefined" && target instanceof Node) {
    return target.parentElement;
  }
  return null;
}

function cssStringEscape(value: string): string {
  // Paths and ids may contain `.`, `#`, quotes, backslashes, or control
  // characters. Attribute selectors place those values inside a quoted CSS
  // string, so escaping follows CSS string rules rather than identifier rules.
  // The space after a hex escape terminates it before the next literal
  // character in the selector.
  return value.replace(/["\\\n\r\f]/g, (char) => {
    switch (char) {
      case '"':
        return "\\22 ";
      case "\\":
        return "\\5c ";
      case "\n":
        return "\\a ";
      case "\r":
        return "\\d ";
      case "\f":
        return "\\c ";
      default:
        return char;
    }
  });
}
