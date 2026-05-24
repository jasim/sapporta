import {
  CELL_EDITING_GRID,
  type GridInteractionConfig,
} from "../types/interaction";

// Runtime construction is the only place where an optional interaction config
// becomes mandatory. After `createGridRuntime`, all code can branch on the
// normalized discriminants instead of asking whether the caller provided a
// config at all.
export function normalizeInteraction(
  interaction?: GridInteractionConfig,
): GridInteractionConfig {
  const normalized = interaction ?? CELL_EDITING_GRID;
  assertValidInteraction(normalized);
  return normalized;
}

export function assertValidInteraction(
  interaction: GridInteractionConfig,
): void {
  // These checks mirror the type-level union but keep the runtime boundary
  // honest for JavaScript callers or values deserialized from configuration.
  if (interaction.mode === "cell-grid") {
    if (interaction.activeCell.kind !== "enabled") {
      throw new Error("cell-grid interaction requires an active cell.");
    }
    return;
  }

  if (interaction.activeCell.kind !== "none") {
    throw new Error("row-list interaction cannot have an active cell.");
  }
  if (interaction.selectedCells.kind !== "none") {
    throw new Error("row-list interaction cannot have selected cells.");
  }
}
