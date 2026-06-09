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
    if (
      interaction.activeCell.keyboard.arrows.tabular !== "grid" &&
      interaction.activeCell.keyboard.arrows.tabular !== "field-list"
    ) {
      throw new Error("cell-grid interaction has an invalid tabular arrow policy.");
    }
    if (
      interaction.activeCell.keyboard.arrows.cards !== "grid" &&
      interaction.activeCell.keyboard.arrows.cards !== "field-list"
    ) {
      throw new Error("cell-grid interaction has an invalid cards arrow policy.");
    }
    return;
  }

  if (interaction.activeCell.kind !== "none") {
    throw new Error("row-list interaction cannot have an active cell.");
  }
  if (interaction.selectedCells.kind !== "none") {
    throw new Error("row-list interaction cannot have selected cells.");
  }
  if (
    interaction.activeRow.keyboard.expansion !== "left-right-enter" &&
    interaction.activeRow.keyboard.expansion !== "none"
  ) {
    throw new Error("row-list interaction has an invalid expansion key policy.");
  }
}
