/**
 * Column factories — the single declaration site for Sapporta columns.
 *
 * Each factory picks the Drizzle storage type whose native SQL behavior
 * matches the intent (REAL for numbers, INTEGER for booleans, TEXT for
 * dates/timestamps/free-form strings) and stamps the column's semantic
 * `kind` in one move. Storage choice and kind cannot drift, because
 * there is no second declaration site.
 *
 * Factories return the underlying Drizzle builder so user schemas keep
 * working with `sqliteTable(...)`:
 *
 *     sqliteTable("accounts", {
 *       id: integer("id").primaryKey(),
 *       balance: money("balance"),         // real(...) + kind "number"
 *       opened: date("opened"),             // text(...) + kind "date"
 *     })
 *
 * Meta is captured via a module-level pending queue that `sapportaTable()`
 * drains on invocation. This is safe for the synchronous-declaration
 * idiom — the schema definition runs start-to-finish before the next
 * `sapportaTable()` call — and fragile only if factory calls are interleaved
 * across `sapportaTable()` calls, which no reasonable declaration style does.
 *
 * See docs/DATA-TYPE-PRINCIPLES.md §3, Phase 2.
 */

import {
  customType,
  integer,
  real,
  text as drizzleText,
} from "drizzle-orm/sqlite-core";
import type { ColumnMeta } from "@sapporta/shared/value-kind";
import {
  Temporal,
  formatCanonicalInstant,
  formatPlainDate,
  parseCanonicalInstant,
  parsePlainDate,
} from "@sapporta/shared/temporal";

// The user-facing API keeps Drizzle schema and Sapporta metadata separate:
// users write a real `sqliteTable(...)`, then pass it with Sapporta `meta` to
// `sapportaTable({ drizzle, meta })`. Column factories must therefore keep returning
// plain Drizzle builders, while still carrying Sapporta-only semantics such as
// `kind` and `displayFormat`. This queue is the temporary side channel that
// lets `sapportaTable()` combine those two authored pieces into one TableDef.
const pending: Array<{ name: string; meta: ColumnMeta }> = [];

function register(name: string, meta: ColumnMeta): void {
  pending.push({ name, meta });
}

/**
 * Move queued factory metadata into the table currently being wrapped.
 * Column names keep metadata for later tables in the queue, so two tables
 * declared before their `sapportaTable()` wrappers still receive the right entries.
 *
 * Example:
 *
 *     const t1 = sqliteTable("a", { created_at: timestamp("created_at") });
 *     const t2 = sqliteTable("b", { created_at: timestamp("created_at") });
 *     const a = sapportaTable({ drizzle: t1, meta: { rowLabelColumns: ["created_at"] } });
 *     const b = sapportaTable({ drizzle: t2, meta: { rowLabelColumns: ["created_at"] } });
 *
 * Factories run synchronously while `sqliteTable(...)` builds its columns, so
 * a table's entries form a contiguous queue segment. The drain stops at the
 * first unknown column name or repeated column name, because either condition
 * means the next queued entry belongs to another table.
 */
export function drainPendingColumnMeta(
  names: readonly string[],
): Map<string, ColumnMeta> {
  const want = new Set(names);
  const map = new Map<string, ColumnMeta>();
  let consumed = 0;
  for (const entry of pending) {
    if (!want.has(entry.name) || map.has(entry.name)) break;
    map.set(entry.name, entry.meta);
    consumed += 1;
  }
  pending.splice(0, consumed);
  return map;
}

// Why the generic: `text("food_name")` returns a builder whose type includes
// the column name — `SQLiteTextBuilderInitial<"food_name", ...>`. Which name
// type it gets depends on how the parameter is declared here: `name: TName`
// gives the literal `"food_name"`, `name: string` gives only `string`.
//
// That is problematic because `TableRow` uses those name types as the row's
// property keys — our rows are keyed by database column name, not by the Drizzle
// property name. A key of type `string` is not a real key. TypeScript turns it
// into an index signature, `[x: string]: ...`, and merges into it the value
// type of every column that has one. So with `name: string` all eight
// factories end up in that one index signature, and `row.food_name` reads as
// `string | number | Instant | null` instead of `string | null`.
//
// Once the name type is `string` the literal is gone for good, so this is the
// one place it can be kept.

// ── Numeric kinds ─────────────────────────────────────────────────────

export function money<TName extends string>(name: TName) {
  register(name, { kind: "number", displayFormat: "currency" });
  return real(name);
}

export function percentage<TName extends string>(name: TName) {
  register(name, { kind: "number", displayFormat: "percentage" });
  return real(name);
}

export function number<TName extends string>(name: TName) {
  register(name, { kind: "number" });
  return real(name);
}

/**
 * A text column whose allowed values are declared once on the Drizzle column.
 * Sapporta reads the same enum values for runtime validation and metadata.
 */
export function select<
  const TOptions extends readonly [string, ...string[]],
  TName extends string,
>(name: TName, options: TOptions) {
  register(name, { kind: "text" });
  return drizzleText(name, { enum: options });
}

// ── Boolean kind ──────────────────────────────────────────────────────

export function bool<TName extends string>(name: TName) {
  register(name, { kind: "boolean" });
  return integer(name, { mode: "boolean" });
}

// ── Temporal kinds ────────────────────────────────────────────────────
//
// The factory is the only place that knows the storage dialect's string
// form. `toDriver` serializes `Temporal.*` (or a pre-canonicalized string)
// to the fixed-width TEXT SQLite wants; `fromDriver` reverses the string
// back into a Temporal object. API and write validation use canonical JSON
// strings; direct Drizzle application code may use Temporal objects. The driver
// accepts both inputs and enforces the same storage representation.

const plainDateColumn = customType<{
  data: Temporal.PlainDate;
  driverData: string;
}>({
  dataType: () => "text",
  toDriver: (value) => {
    // Save-boundary parsing produces canonical strings, while direct Drizzle
    // callers use the declared Temporal type. Parsing and re-serializing string
    // input preserves the storage invariant for both paths.
    if (typeof value === "string")
      return formatPlainDate(parsePlainDate(value));
    return formatPlainDate(value);
  },
  fromDriver: (value) => parsePlainDate(value),
});

const instantColumn = customType<{
  data: Temporal.Instant;
  driverData: string;
}>({
  dataType: () => "text",
  toDriver: (value) => {
    if (typeof value === "string")
      return formatCanonicalInstant(parseCanonicalInstant(value));
    return formatCanonicalInstant(value);
  },
  fromDriver: (value) => parseCanonicalInstant(value),
});

/**
 * `TEXT` (ISO `YYYY-MM-DD`) + kind `"date"`. Lex order equals calendar
 * order under ISO, so `ORDER BY` needs no special casing. The Drizzle
 * `customType` wrapper accepts canonical strings from Sapporta's save pipeline
 * and `Temporal.PlainDate` values from direct Drizzle callers. Database reads
 * return `Temporal.PlainDate`.
 */
export function date<TName extends string>(name: TName) {
  register(name, { kind: "date" });
  return plainDateColumn(name);
}

/**
 * `TEXT` (canonical `YYYY-MM-DDTHH:mm:ssZ`) + kind `"timestamp"`. Fixed
 * width with trailing `Z` is what makes lex-order equal chronological
 * order; the `customType` wrapper is where that invariant is enforced
 * on every write.
 */
export function timestamp<TName extends string>(name: TName) {
  register(name, { kind: "timestamp" });
  return instantColumn(name);
}

// ── Text kind ─────────────────────────────────────────────────────────

export function text<TName extends string>(name: TName) {
  register(name, { kind: "text" });
  return drizzleText(name);
}
