import type { CellSelectionStatus } from "../../types/selection";

// Pure class-name composer. Active/ghost is handled by CSS descendant
// selectors on the grid container's [data-active] attribute, not by a
// per-cell class — see grid.css. cellClasses sees only the cell-scoped
// concern: selection status.
export function cellClasses(status: CellSelectionStatus): string {
  const classes = ["grid-cell"];
  if (status !== "none") classes.push(`grid-cell--${status}`);
  return classes.join(" ");
}
