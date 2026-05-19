/**
 * Value-kind vocabulary — the minimal semantic taxonomy for column values.
 *
 * SQLite storage is lossy about intent: INTEGER could be a number or a
 * boolean; TEXT could be free-form text, a date, or a timestamp. `ValueKind`
 * disambiguates those cases, and *only* those — everything else the query
 * layer needs (how `eq`/`gt`/`ORDER BY` behave) falls out of the SQLite
 * storage type the factory picked.
 *
 * See docs/DATA-TYPE-PRINCIPLES.md for the full design.
 */

import type { Operator } from "./filter.js";

export type ValueKind = "text" | "number" | "boolean" | "date" | "timestamp";

/**
 * Semantic metadata a column factory stamps on its Drizzle output.
 *
 * This is the *minimum* a consumer needs to parse inputs, decide which
 * operators apply, and format for display. Anything derivable from the
 * Drizzle column itself (SQLite type, NOT NULL, PK, FK columns) is NOT
 * duplicated here.
 */
export interface ColumnMeta {
  /** Semantic kind. Drives parse rules and operator applicability. */
  kind: ValueKind;
  /** Presentation-only hint. Does NOT participate in query semantics. */
  displayFormat?: "currency" | "percentage";
  /** Foreign key target, if this column references another table. */
  foreignKey?: { table: string; column: string };
  /** Enumeration options, if this column is restricted to a fixed set. */
  options?: readonly string[];
}

/**
 * The operator-applicability matrix — as data, not branches.
 *
 * UI and server both consult this; they cannot drift, because there is
 * only one table. New kind or new operator? The gap in this map is where
 * the decision gets made.
 */
export const OPERATOR_APPLICABILITY: Record<ValueKind, readonly Operator[]> = {
  text: ["eq", "neq", "contains", "startswith", "endswith", "in", "nin", "is"],
  number: ["eq", "neq", "gt", "gte", "lt", "lte", "in", "nin", "is"],
  boolean: ["eq", "neq", "is"],
  date: ["eq", "neq", "gt", "gte", "lt", "lte", "in", "nin", "is"],
  timestamp: ["eq", "neq", "gt", "gte", "lt", "lte", "in", "nin", "is"],
};

/**
 * Sole reader of the matrix. Returns true iff `op` is allowed on `kind`.
 * Callers who want to raise a typed error wrap this; keeping the predicate
 * side-effect-free lets it be used from UI affordance logic too.
 */
export function isOperatorApplicable(kind: ValueKind, op: Operator): boolean {
  return OPERATOR_APPLICABILITY[kind].includes(op);
}

