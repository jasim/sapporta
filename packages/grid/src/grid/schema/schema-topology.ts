// SchemaTopology — pure derivation from a `GridSchema`.
//
// Answers "what levels exist by name and how do they connect?" Knows
// nothing about paths, expansion, or data — PathTopology owns the
// dynamic side. SchemaTopology is the static name-graph derived once per
// runtime from the schema reference.
//
// Validation choke point: because `buildSchemaTopology` is the first
// place that walks a `GridSchema`, it validates structural constraints
// that must hold for the grid to function correctly:
//   - Each level's column ids must be unique.
//   - A data-backed row header must reference the first visible column, and
//     that column must be readonly.
//   - Column edit and activation gestures must be internally consistent.
//   - Every level receives stable identity from required `TreeNode.rowKey`
//     values at the source boundary.
//   - No cycles: a level cannot appear as both ancestor and descendant
//     of itself.
//   - No diamond: a child level name cannot be declared by two parents.
//   - The rootLevel must exist in `schema.levels`.
//
// `childLevels` order is semantically significant: it determines the render order
// of child levels under an expanded row.

import type {
  CellActivationGesture,
  CellEditGesture,
  ColumnSchema,
  GridSchema,
  LevelSchema,
} from "../types/schema";

export type SchemaTopology = {
  readonly rootLevelName: string;
  readonly levelOf: (levelName: string) => LevelSchema;
  readonly childLevelsOf: (levelName: string) => readonly string[];
  readonly parentLevelOf: (levelName: string) => string | null;
};

export function buildSchemaTopology(schema: GridSchema): SchemaTopology {
  const levelNames = Object.keys(schema.levels);

  if (!schema.levels[schema.rootLevel]) {
    throw new Error(
      `SchemaTopology: rootLevel "${schema.rootLevel}" is not in schema.levels (have: ${levelNames.join(", ") || "<none>"})`,
    );
  }

  for (const name of levelNames) {
    if (name === "") {
      throw new Error("SchemaTopology: level names must be non-empty");
    }
  }

  for (const name of levelNames) {
    validateLevelColumns(name, schema.levels[name]);
  }

  // Invert `level.childLevels`: build child → parent. Detect duplicate
  // parents (the same child name declared by two parents) at construction.
  const parentByChild = new Map<string, string>();
  for (const parentName of levelNames) {
    const level = schema.levels[parentName];
    for (const childName of level.childLevels) {
      const existing = parentByChild.get(childName);
      if (existing && existing !== parentName) {
        throw new Error(
          `SchemaTopology: child level "${childName}" is declared by two parents ("${existing}" and "${parentName}")`,
        );
      }
      parentByChild.set(childName, parentName);
    }
  }

  // Cycle detection: walk parents from each level; if we ever see a level
  // that is its own ancestor, the schema has a cycle.
  for (const start of levelNames) {
    const seen = new Set<string>();
    let cur: string | undefined = start;
    while (cur) {
      if (seen.has(cur)) {
        throw new Error(
          `SchemaTopology: cycle detected involving level "${cur}"`,
        );
      }
      seen.add(cur);
      cur = parentByChild.get(cur);
      if (cur === start) {
        throw new Error(
          `SchemaTopology: cycle detected involving level "${start}"`,
        );
      }
    }
  }

  function assertKnown(name: string): void {
    if (!schema.levels[name]) {
      throw new Error(
        `SchemaTopology: unknown level "${name}" (have: ${levelNames.join(", ") || "<none>"})`,
      );
    }
  }

  return {
    rootLevelName: schema.rootLevel,
    levelOf: (name) => {
      assertKnown(name);
      return schema.levels[name];
    },
    childLevelsOf: (name) => {
      assertKnown(name);
      return schema.levels[name].childLevels;
    },
    parentLevelOf: (name) => {
      assertKnown(name);
      if (name === schema.rootLevel) return null;
      return parentByChild.get(name) ?? null;
    },
  };
}

function validateLevelColumns(levelName: string, level: LevelSchema): void {
  const seen = new Set<string>();
  for (const column of level.columns) {
    if (seen.has(column.id)) {
      throw new Error(
        `SchemaTopology: level "${levelName}" has duplicate column id "${column.id}"`,
      );
    }
    seen.add(column.id);
    validateColumnInteractions(levelName, column);
  }
  validateLevelRowHeaderColumn(levelName, level);
}

export function validateLevelRowHeaderColumn(
  levelName: string,
  level: Pick<LevelSchema, "columns" | "rowHeaderColumn">,
  label = "SchemaTopology",
): void {
  const rowHeader = level.rowHeaderColumn;
  const columns = level.columns;
  const available = `[${columns.map((column) => column.id).join(", ")}]`;
  const leftMost = columns[0]?.id ?? "<none>";

  if (rowHeader === undefined || rowHeader === null) {
    throw new Error(
      `${label}: level "${levelName}" must declare rowHeaderColumn`,
    );
  }
  if (rowHeader === "empty-selectable-cell" || rowHeader === "none") return;
  if (typeof rowHeader !== "object" || typeof rowHeader.column !== "string") {
    throw new Error(
      `${label}: level "${levelName}" has invalid rowHeaderColumn`,
    );
  }

  const requested = rowHeader.column;
  const column = columns.find((candidate) => candidate.id === requested);
  if (!column) {
    throw new Error(
      `${label}: level "${levelName}" rowHeaderColumn requested column "${requested}", but it is not visible (left-most column: "${leftMost}"; available columns: ${available})`,
    );
  }
  if (columns[0] !== column) {
    throw new Error(
      `${label}: level "${levelName}" rowHeaderColumn requested column "${requested}", but the left-most column is "${leftMost}" (available columns: ${available})`,
    );
  }
  if (column.edit) {
    throw new Error(
      `${label}: level "${levelName}" rowHeaderColumn requested column "${requested}", but it is editable; row-header columns must be readonly (left-most column: "${leftMost}"; available columns: ${available})`,
    );
  }
}

function validateColumnInteractions(
  levelName: string,
  column: ColumnSchema,
): void {
  if (column.edit) {
    if (!column.edit.editor) {
      throw new Error(
        `SchemaTopology: column "${levelName}.${column.id}" declares edit without an editor`,
      );
    }
    assertUniqueGestures(
      `SchemaTopology: column "${levelName}.${column.id}" repeats edit gesture`,
      column.edit.startsOn,
    );
  }

  if (column.activation) {
    if (!column.activation.describe) {
      throw new Error(
        `SchemaTopology: column "${levelName}.${column.id}" declares activation without describe`,
      );
    }
    if (!column.activation.run) {
      throw new Error(
        `SchemaTopology: column "${levelName}.${column.id}" declares activation without run`,
      );
    }
    assertUniqueGestures(
      `SchemaTopology: column "${levelName}.${column.id}" repeats activation gesture`,
      column.activation.startsOn,
    );
  }

  if (!column.edit || !column.activation) return;
  const editGestures = new Set<CellEditGesture>(column.edit.startsOn);
  for (const activationGesture of column.activation.startsOn) {
    if (gestureOverlaps(editGestures, activationGesture)) {
      throw new Error(
        `SchemaTopology: column "${levelName}.${column.id}" assigns "${activationGesture}" to both edit and activation`,
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
