import type { ComponentType, ReactNode } from "react";
import type { GridPath } from "@sapporta/grid";
import type { LookupValue } from "@sapporta/grid/lookup";
import type { Json, Row, TableSchema } from "@sapporta/shared/contracts";

/**
 * Where a row is drawn:
 * - `"cell"`: a grid cell, in table or card layout, at any level;
 * - `"option"`: an option in a combobox or a filter checklist;
 * - `"selected"`: beside a picker's input, for the chosen value;
 * - `"field"`: a read-only value in the record sheet;
 * - `"chip"`: inside a filter chip's one-line summary.
 */
export type Surface = "cell" | "option" | "selected" | "field" | "chip";

/** What a slot knows about the place it draws in. */
export type DisplayContext = {
  /** Drawn as the row itself, or as a reference to it from another row. */
  as: "self" | "reference";
  surface: Surface;
  /** Grid cells and the grid editor are compact; pickers, forms and the
   *  record sheet are regular. */
  density: "compact" | "regular";
  /** The table, column and grid level showing the row. */
  source?: { table: string; column?: string; levelPath?: GridPath };
  /** The view already shows where this row sits in its table's tree, so a
   *  parent path under the label would repeat it. */
  hierarchyShown: boolean;
  /** For options: the current value. */
  selected?: boolean;
  /** For options in a tree picker, set only on the row being edited, such as
   *  the account whose parent is being chosen: the words drawn after its
   *  label, the picker's `labels.editing`. The row is drawn where it sits, so
   *  the person sees it, but it cannot be picked. */
  editingNote?: string;
};

/** Computed field values of one row, by field name. */
export type ComputedRecord = Readonly<Record<string, Json>>;

type SlotPropsBase = {
  context: DisplayContext;
  /** What Sapporta draws without this slot. Return it to keep the default,
   *  or wrap it. */
  defaultContent: ReactNode;
};

/** Props of a `label` slot: a row's identity. */
export type LabelSlotProps<TComputed = ComputedRecord> = SlotPropsBase & {
  id: LookupValue;
  /** The row label, built from the table's `rowLabelColumns`. */
  label: string;
  /** The values of the fields the slot `needs`. */
  computed: TComputed;
  /** The row, when it is drawn as itself (`context.as === "self"`). */
  row?: Readonly<Row>;
};

/** Props of a `columns` slot: one cell of the table's own rows. */
export type CellSlotProps<TComputed = ComputedRecord> = SlotPropsBase & {
  /** The cell's column value. */
  value: unknown;
  row: Readonly<Row>;
  /** The values of the fields the slot `needs`, for this row. */
  computed: TComputed;
};

/** Props of a `columns` slot on a foreign-key column. */
export type ReferenceSlotProps<TComputed = ComputedRecord> =
  CellSlotProps<TComputed> & {
    /** The referenced row, with the values of `referenceNeeds`, or `null`
     *  when the cell is empty or the row is not loaded yet. */
    reference: {
      id: LookupValue;
      label: string;
      computed: ComputedRecord;
    } | null;
  };

export type Slot<P> = {
  /** Computed fields of the drawn row that `render` reads. Sapporta asks for
   *  them wherever the slot is drawn, and draws `render` once all are known. */
  needs?: readonly string[];
  /** On a foreign-key column: computed fields of the referenced row. */
  referenceNeeds?: readonly string[];
  /** Leave it out to keep the default drawing, while still asking for
   *  `needs`. To draw differently on some surfaces, branch on
   *  `context.surface`, and return `defaultContent` where the default
   *  should stay. */
  render?: ComponentType<P>;
};

/** A slot on one column of a table. */
export type ColumnSlot = Slot<CellSlotProps> | Slot<ReferenceSlotProps>;

/** How the rows of one table are drawn. */
export type TableDisplay = {
  /** A row's identity: its own label cell, and every reference to it. */
  label?: Slot<LabelSlotProps>;
  /** One cell of this table's own rows, by column name. A slot on a
   *  foreign-key column also decides how this table draws its references. */
  columns?: Record<string, ColumnSlot>;
};

/** Display slots by table name. */
export type RowDisplays = Readonly<Record<string, TableDisplay>>;

/**
 * Declares how rows are drawn, per table. Pass the result to
 * `RowDisplayProvider`.
 *
 * ```tsx
 * const displays = defineRowDisplays({
 *   items: { label: { needs: ["onHand"], render: ItemLabel } },
 * });
 * ```
 */
export function defineRowDisplays<const T extends RowDisplays>(displays: T): T {
  return displays;
}

/**
 * Merges `inner` over `outer`, by table and then by slot: a table in `inner`
 * replaces only the slots it names. Setting a slot to `{}` restores the
 * default drawing.
 */
export function mergeRowDisplays(
  outer: RowDisplays,
  inner: RowDisplays,
): RowDisplays {
  const merged: Record<string, TableDisplay> = { ...outer };
  for (const [table, display] of Object.entries(inner)) {
    const base = merged[table] ?? {};
    merged[table] = {
      ...base,
      ...(display.label !== undefined ? { label: display.label } : {}),
      ...(display.columns !== undefined
        ? { columns: { ...base.columns, ...display.columns } }
        : {}),
    };
  }
  return merged;
}

/**
 * Checks display slots against the table schemas, and throws on a table,
 * column or computed field that does not exist. Tables missing from
 * `tables` are not checked, since their schema is not loaded.
 */
export function checkRowDisplays(
  displays: RowDisplays,
  tables: readonly TableSchema[],
): void {
  const byName = new Map(tables.map((table) => [table.name, table]));
  for (const [tableName, display] of Object.entries(displays)) {
    const table = byName.get(tableName);
    if (!table) continue;
    const where = `Row displays for table '${tableName}'`;
    const fieldNames = new Set((table.computed ?? []).map((f) => f.name));
    const checkNeeds = (
      needs: readonly string[] | undefined,
      slot: string,
      fields: ReadonlySet<string>,
      fieldsOf: string,
    ) => {
      for (const name of needs ?? []) {
        if (!fields.has(name)) {
          throw new Error(
            `${where}: ${slot} needs '${name}', which is not a computed field of '${fieldsOf}'.`,
          );
        }
      }
    };
    checkNeeds(display.label?.needs, "the label slot", fieldNames, tableName);
    for (const [columnName, slot] of Object.entries(display.columns ?? {})) {
      const column = table.columns.find((c) => c.name === columnName);
      if (!column) {
        throw new Error(`${where}: there is no column '${columnName}'.`);
      }
      checkNeeds(slot.needs, `column '${columnName}'`, fieldNames, tableName);
      const target = column.foreignKey
        ? byName.get(column.foreignKey.table)
        : undefined;
      if (slot.referenceNeeds && !column.foreignKey) {
        throw new Error(
          `${where}: column '${columnName}' has referenceNeeds but is not a foreign key.`,
        );
      }
      if (target) {
        checkNeeds(
          slot.referenceNeeds,
          `column '${columnName}' referenceNeeds`,
          new Set((target.computed ?? []).map((f) => f.name)),
          target.name,
        );
      }
    }
  }
}
