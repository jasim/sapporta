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
 * Meta is captured via a module-level pending queue that `table()`
 * drains on invocation. This is safe for the synchronous-declaration
 * idiom — the schema definition runs start-to-finish before the next
 * `table()` call — and fragile only if factory calls are interleaved
 * across `table()` calls, which no reasonable declaration style does.
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
// `table({ drizzle, meta })`. Column factories must therefore keep returning
// plain Drizzle builders, while still carrying Sapporta-only semantics such as
// `kind` and `displayFormat`. This queue is the temporary side channel that
// lets `table()` combine those two authored pieces into one TableDef.
const pending: Array<{ name: string; meta: ColumnMeta }> = [];

function register(name: string, meta: ColumnMeta): void {
  pending.push({ name, meta });
}

/**
 * Move queued factory metadata into the table currently being wrapped.
 * Column names keep metadata for later tables in the queue, so two tables
 * declared before their `table()` wrappers still receive the right entries.
 *
 * Example:
 *
 *     const t1 = sqliteTable("a", { created_at: timestamp("created_at") });
 *     const t2 = sqliteTable("b", { created_at: timestamp("created_at") });
 *     const a = table({ drizzle: t1 });  // consumes only t1 metadata
 *     const b = table({ drizzle: t2 });  // t2 metadata remains queued
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

// ── Numeric kinds ─────────────────────────────────────────────────────

export function money(name: string) {
  register(name, { kind: "number", displayFormat: "currency" });
  return real(name);
}

export function percentage(name: string) {
  register(name, { kind: "number", displayFormat: "percentage" });
  return real(name);
}

export function number(name: string) {
  register(name, { kind: "number" });
  return real(name);
}

// ── Boolean kind ──────────────────────────────────────────────────────

export function bool(name: string) {
  register(name, { kind: "boolean" });
  return integer(name, { mode: "boolean" });
}

// ── Temporal kinds ────────────────────────────────────────────────────
//
// The factory is the only place that knows the storage dialect's string
// form. `toDriver` serializes `Temporal.*` (or a pre-canonicalized string)
// to the fixed-width TEXT SQLite wants; `fromDriver` reverses the string
// back into a Temporal object. Everything between the boundary parse and
// the driver carries Temporal objects — the dialect-isolation claim from
// docs/DATA-TYPE-PRINCIPLES.md §4 has one concrete enforcement point here.

const plainDateColumn = customType<{
  data: Temporal.PlainDate;
  driverData: string;
}>({
  dataType: () => "text",
  toDriver: (value) => {
    // Runtime tolerance: accept a pre-canonicalized ISO string (e.g. from
    // user-submitted JSON, before the boundary parse has turned it into a
    // Temporal). Parsing + re-serializing guarantees storage invariants.
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
 * `customType` wrapper handles `Temporal.PlainDate` ↔ canonical TEXT in
 * one direction each — the pipeline above this factory never sees the
 * string form.
 */
export function date(name: string) {
  register(name, { kind: "date" });
  return plainDateColumn(name);
}

/**
 * `TEXT` (canonical `YYYY-MM-DDTHH:mm:ssZ`) + kind `"timestamp"`. Fixed
 * width with trailing `Z` is what makes lex-order equal chronological
 * order; the `customType` wrapper is where that invariant is enforced
 * on every write.
 */
export function timestamp(name: string) {
  register(name, { kind: "timestamp" });
  return instantColumn(name);
}

// ── Text kind ─────────────────────────────────────────────────────────

export function text(name: string) {
  register(name, { kind: "text" });
  return drizzleText(name);
}
