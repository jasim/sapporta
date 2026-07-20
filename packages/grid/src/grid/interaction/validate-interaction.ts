import type {
  GridInteractionConfig,
  RowActivationGesture,
} from "../types/interaction";

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
      throw new Error(
        "cell-grid interaction has an invalid tabular arrow policy.",
      );
    }
    if (
      interaction.activeCell.keyboard.arrows.cards !== "grid" &&
      interaction.activeCell.keyboard.arrows.cards !== "field-list"
    ) {
      throw new Error(
        "cell-grid interaction has an invalid cards arrow policy.",
      );
    }
    if (
      interaction.activeRow.kind === "from-active-cell" &&
      interaction.activeRow.activation
    ) {
      assertValidRowActivation(interaction.activeRow.activation, "cell-grid");
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
    interaction.activeRow.keyboard.expansion !== "left-right" &&
    interaction.activeRow.keyboard.expansion !== "none"
  ) {
    throw new Error(
      "row-list interaction has an invalid expansion key policy.",
    );
  }
  if (interaction.activeRow.activation) {
    assertValidRowActivation(interaction.activeRow.activation, "row-list");
  }
  if (
    interaction.activeRow.keyboard.expansion === "left-right-enter" &&
    interaction.activeRow.activation?.startsOn.includes("enter")
  ) {
    throw new Error(
      "row-list interaction cannot assign Enter to both activation and expansion.",
    );
  }
}

function assertValidRowActivation(
  activation: { readonly startsOn: readonly RowActivationGesture[] },
  mode: "cell-grid" | "row-list",
): void {
  const seen = new Set<RowActivationGesture>();
  for (const gesture of activation.startsOn) {
    if (
      gesture !== "enter" &&
      gesture !== "click" &&
      gesture !== "doubleClick"
    ) {
      throw new Error(`${mode} interaction has an invalid activation gesture.`);
    }
    if (seen.has(gesture)) {
      throw new Error(`${mode} interaction repeats a row activation gesture.`);
    }
    seen.add(gesture);
  }
  if (seen.has("click") && seen.has("doubleClick")) {
    throw new Error(
      `${mode} interaction cannot assign both click and doubleClick to row activation.`,
    );
  }
}
