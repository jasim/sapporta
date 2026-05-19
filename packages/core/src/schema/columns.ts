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

const pending: Array<{ name: string; meta: ColumnMeta }> = [];

function register(name: string, meta: ColumnMeta): void {
  pending.push({ name, meta });
}

/**
 * Drain factory-registered metadata for the given column names. Called by
 * `table()` when wrapping a Drizzle schema — it passes the set of column
 * names present on the drizzle config so registrations meant for *other*
 * tables stay in the queue.
 *
 * Two-table patterns like
 *
 *     const t1 = sqliteTable("a", { x: timestamp("x") });
 *     const t2 = sqliteTable("b", { y: timestamp("y") });
 *     const a = table({ drizzle: t1 });  // must only consume "x"
 *     const b = table({ drizzle: t2 });  // must still see "y"
 *
 * must route meta to the correct table. Keying the drain by the drizzle
 * table's own column names is what keeps that coupling local and avoids a
 * hidden dependency on declaration order.
 */
export function drainPendingColumnMeta(
  names: readonly string[],
): Map<string, ColumnMeta> {
  const want = new Set(names);
  const map = new Map<string, ColumnMeta>();
  // Consume the leading prefix of the queue that belongs to this table.
  // A factory call registers in the same JS turn as the `sqliteTable(...)`
  // definition, so all of a table's factory entries land contiguously at
  // the head of the queue before the next `table()` call drains them.
  // Stop at the first non-match *or* the first duplicate name — a repeat
  // means we've crossed into the next table's registrations (two tables
  // both with a `created_at`, for instance).
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
    if (typeof value === "string") return formatPlainDate(parsePlainDate(value));
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
