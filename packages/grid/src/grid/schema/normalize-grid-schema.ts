import type {
  CellActivationGesture,
  CellEditGesture,
  ColumnSchema,
  GridSchema,
} from "../types/schema";

export function normalizeGridSchema(schema: GridSchema): GridSchema {
  for (const [levelName, level] of Object.entries(schema.levels)) {
    const seen = new Set<string>();
    for (const column of level.columns) {
      if (seen.has(column.id)) {
        throw new Error(
          `GridSchema: level "${levelName}" has duplicate column id "${column.id}"`,
        );
      }
      seen.add(column.id);
      validateColumnInteractions(levelName, column);
    }
  }
  return schema;
}

function validateColumnInteractions(
  levelName: string,
  column: ColumnSchema,
): void {
  if (column.edit) {
    if (!column.edit.editor) {
      throw new Error(
        `GridSchema: column "${levelName}.${column.id}" declares edit without an editor`,
      );
    }
    assertUniqueGestures(
      `GridSchema: column "${levelName}.${column.id}" repeats edit gesture`,
      column.edit.startsOn,
    );
  }

  if (column.activation) {
    if (!column.activation.describe) {
      throw new Error(
        `GridSchema: column "${levelName}.${column.id}" declares activation without describe`,
      );
    }
    if (!column.activation.run) {
      throw new Error(
        `GridSchema: column "${levelName}.${column.id}" declares activation without run`,
      );
    }
    assertUniqueGestures(
      `GridSchema: column "${levelName}.${column.id}" repeats activation gesture`,
      column.activation.startsOn,
    );
  }

  if (!column.edit || !column.activation) return;
  const editGestures = new Set<CellEditGesture>(column.edit.startsOn);
  for (const activationGesture of column.activation.startsOn) {
    if (gestureOverlaps(editGestures, activationGesture)) {
      throw new Error(
        `GridSchema: column "${levelName}.${column.id}" assigns "${activationGesture}" to both edit and activation`,
      );
    }
  }
}

function assertUniqueGestures<TGesture extends string>(
  message: string,
  gestures: readonly TGesture[],
): void {
  const seen = new Set<TGesture>();
  for (const gesture of gestures) {
    if (seen.has(gesture)) throw new Error(`${message} "${gesture}"`);
    seen.add(gesture);
  }
}

function gestureOverlaps(
  editGestures: Set<CellEditGesture>,
  activationGesture: CellActivationGesture,
): boolean {
  switch (activationGesture) {
    case "enter":
    case "doubleClick":
      return editGestures.has(activationGesture);
    case "space":
    case "click":
      return false;
  }
}
