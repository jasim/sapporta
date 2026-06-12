/**
 * UI-internal types only.
 *
 * Wire shapes (`ColumnSchema`, `TableSchema`, `Row`, ...)
 * live in `@sapporta/shared/contracts` — the single source of truth shared
 * with the server. Components import them from there directly.
 *
 * Keep this file small. If you reach for it to avoid a longer import path,
 * you're probably hand-rolling a wire shape — put it in shared instead.
 */

/** A lookup table from stable string keys to their display labels. In the
 *  FK context: foreign-key id → human label, populated incrementally as
 *  rows load (a missing key means "not seen yet", not "invalid"). */
export type KeyedValues = Record<string, string>;

/** Per-column KeyedValues map, keyed by the local column name. Threaded
 *  through the filter UI so pickers and pills can show labels instead of
 *  raw ids. */
export type FkOptionsMap = Record<string, KeyedValues>;
