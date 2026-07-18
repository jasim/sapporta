/**
 * Column-type filter catalog.
 *
 * One place, one data structure: for each filter-column type, the default
 * operator and the set of valid operators — each tagged with its
 * `valueShape`, which determines the editor's input component and the
 * resulting `FilterCondition` variant.
 *
 * The three value shapes map cleanly to the three `FilterCondition`
 * variants in `@sapporta/shared/filter`:
 *
 *   scalar → `{ op: ScalarOp; value: string }`      + ScalarInputComponent
 *   list   → `{ op: ListOp;   values: string[] }`   + ListInputComponent
 *   none   → `{ op: "is";     polarity }`           + no input
 *
 * Two UI operators (`is empty`, `is not empty`) both compile to the grammar
 * op `is`, differing only by `polarity`. The catalog `key` is the stable
 * React/dropdown id; `op` is the grammar op.
 */

import type { ColumnSchema } from "@sapporta/shared/contracts";
import type {
  LookupListInputComponent,
  ScalarInputComponent,
  StaticListInputComponent,
  TagListInputComponent,
} from "./inputs/types";
import { TextInput, NumberInput, DateInput } from "./inputs/ScalarInput";
import { TagInput } from "./inputs/TagInput";
import { EnumCombobox } from "./inputs/EnumCombobox";
import { LookupCheckboxList } from "./inputs/LookupCheckboxList";
import type { ListOp, Polarity, ScalarOp } from "@sapporta/shared/filter";
import { inferDisplayType } from "../model/column-types";

/** Filter-side column types — coarser than the render-side DisplayType. */
export type FilterColumnType =
  "text" | "number" | "date" | "boolean" | "enum" | "fk";

export type OpEntry =
  | {
      key: string;
      label: string;
      valueShape: "scalar";
      op: ScalarOp;
      Input: ScalarInputComponent;
    }
  | {
      key: string;
      label: string;
      valueShape: "list";
      inputKind: "tag";
      op: ListOp;
      Input: TagListInputComponent;
    }
  | {
      key: string;
      label: string;
      valueShape: "list";
      inputKind: "static";
      op: ListOp;
      Input: StaticListInputComponent;
    }
  | {
      key: string;
      label: string;
      valueShape: "list";
      inputKind: "lookup";
      op: ListOp;
      Input: LookupListInputComponent;
    }
  | {
      key: string;
      label: string;
      valueShape: "none";
      op: "is";
      polarity: Polarity;
    };

export interface ColumnTypeEntry {
  defaultKey: string;
  ops: OpEntry[];
}

/** Map a `ColumnSchema` to its filter-side type. The render-side
 *  `inferDisplayType` is too fine-grained (it distinguishes `currency` from
 *  `number`, `pk` from others); the catalog only cares about input shape. */
export function inferFilterColumnType(col: ColumnSchema): FilterColumnType {
  const dt = inferDisplayType(col);
  if (dt === "fk") return "fk";
  if (dt === "pk") return "number";
  if (dt === "select") return "enum";
  if (dt === "checkbox") return "boolean";
  if (dt === "date" || dt === "timestamp") return "date";
  if (dt === "number" || dt === "currency" || dt === "percentage")
    return "number";
  return "text";
}

/** Resolve the option set (and optional label map) a column offers for
 *  value-set pickers. Used by both the editor and the header popover so the
 *  two paths can't drift. Returns `null` when the column has no fixed set. */
export function resolveColumnOptions(
  column: ColumnSchema,
  type: FilterColumnType,
): { options: string[]; labels?: Record<string, string> } | null {
  if (column.select?.options) {
    return {
      options: column.select.options,
      labels: Object.fromEntries(
        column.select.options.map((option) => [option, option]),
      ),
    };
  }
  if (type === "boolean") return { options: ["true", "false"] };
  return null;
}

// ── Shared entries ───────────────────────────────────────────────────────

const isEmpty: OpEntry = {
  key: "isnull",
  label: "is empty",
  valueShape: "none",
  op: "is",
  polarity: "null",
};
const isNotEmpty: OpEntry = {
  key: "isnotnull",
  label: "is not empty",
  valueShape: "none",
  op: "is",
  polarity: "notnull",
};

// Helpers just to shorten the catalog entries below.
const scalar = (
  key: string,
  label: string,
  op: ScalarOp,
  Input: ScalarInputComponent,
): OpEntry => ({ key, label, valueShape: "scalar", op, Input });

const tagList = (
  key: string,
  label: string,
  op: ListOp,
  Input: TagListInputComponent,
): OpEntry => ({ key, label, valueShape: "list", inputKind: "tag", op, Input });

const staticList = (
  key: string,
  label: string,
  op: ListOp,
  Input: StaticListInputComponent,
): OpEntry => ({
  key,
  label,
  valueShape: "list",
  inputKind: "static",
  op,
  Input,
});

const lookupList = (
  key: string,
  label: string,
  op: ListOp,
  Input: LookupListInputComponent,
): OpEntry => ({
  key,
  label,
  valueShape: "list",
  inputKind: "lookup",
  op,
  Input,
});

// ── Per-type catalogs ────────────────────────────────────────────────────

const text: ColumnTypeEntry = {
  defaultKey: "contains",
  ops: [
    scalar("contains", "contains", "contains", TextInput),
    scalar("eq", "equals", "eq", TextInput),
    scalar("neq", "does not equal", "neq", TextInput),
    scalar("startswith", "starts with", "startswith", TextInput),
    scalar("endswith", "ends with", "endswith", TextInput),
    tagList("in", "is one of", "in", TagInput),
    tagList("nin", "is not one of", "nin", TagInput),
    isEmpty,
    isNotEmpty,
  ],
};

const number: ColumnTypeEntry = {
  defaultKey: "eq",
  ops: [
    scalar("eq", "equals", "eq", NumberInput),
    scalar("neq", "does not equal", "neq", NumberInput),
    scalar("gt", "greater than", "gt", NumberInput),
    scalar("gte", "greater than or equal", "gte", NumberInput),
    scalar("lt", "less than", "lt", NumberInput),
    scalar("lte", "less than or equal", "lte", NumberInput),
    tagList("in", "is one of", "in", TagInput),
    tagList("nin", "is not one of", "nin", TagInput),
    isEmpty,
    isNotEmpty,
  ],
};

const date: ColumnTypeEntry = {
  defaultKey: "gte",
  ops: [
    scalar("eq", "on", "eq", DateInput),
    scalar("neq", "not on", "neq", DateInput),
    scalar("gt", "after", "gt", DateInput),
    scalar("gte", "on or after", "gte", DateInput),
    scalar("lt", "before", "lt", DateInput),
    scalar("lte", "on or before", "lte", DateInput),
    isEmpty,
    isNotEmpty,
  ],
};

const boolean: ColumnTypeEntry = {
  defaultKey: "eq",
  ops: [scalar("eq", "is", "eq", TextInput), isEmpty, isNotEmpty],
};

const enumType: ColumnTypeEntry = {
  defaultKey: "in",
  ops: [
    staticList("in", "is one of", "in", EnumCombobox),
    staticList("nin", "is not one of", "nin", EnumCombobox),
    isEmpty,
    isNotEmpty,
  ],
};

const fk: ColumnTypeEntry = {
  defaultKey: "in",
  ops: [
    lookupList("in", "is one of", "in", LookupCheckboxList),
    lookupList("nin", "is not one of", "nin", LookupCheckboxList),
    isEmpty,
    isNotEmpty,
  ],
};

export const catalog: Record<FilterColumnType, ColumnTypeEntry> = {
  text,
  number,
  date,
  boolean,
  enum: enumType,
  fk,
};

/** Look up a catalog entry by its `key`. Returns `null` if the column-type
 *  entry doesn't include it — callers fall back to `defaultKey`. */
export function findOpEntry(
  type: FilterColumnType,
  key: string,
): OpEntry | null {
  return catalog[type].ops.find((o) => o.key === key) ?? null;
}

/** Reverse lookup: find the catalog entry that matches a stored condition.
 *  For `is`, disambiguates the two UI entries by polarity. */
export function findEntryForCondition(
  type: FilterColumnType,
  op: OpEntry["op"],
  polarity: Polarity | null,
): OpEntry {
  const entries = catalog[type].ops.filter((o) => o.op === op);
  if (entries.length === 0) return catalog[type].ops[0];
  if (op === "is" && polarity) {
    const match = entries.find(
      (o) => o.valueShape === "none" && o.polarity === polarity,
    );
    if (match) return match;
  }
  return entries[0];
}
