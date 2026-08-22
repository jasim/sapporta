/**
 * A primary-key value in an address position — URL path segment, query key,
 * grid row key. A string, because those transports carry only strings. Holds
 * unchanged for INTEGER and UUID primary keys alike.
 *
 * In: ids are sent as strings, then coerced to the column's kind server-side
 * at `normalizeLookupIds` (core/rows/scoped-rows.ts). Single-row reads skip
 * that and rely on SQLite INTEGER affinity in `eq(pk, id)`.
 *
 * Out: ids are returned as the column typed them, so an INTEGER pk comes back
 * a JS number (`lookupValueSchema`, shared/contracts/table-schema.ts). The
 * asymmetry is deliberate — see that schema for why. Cross with `toRecordId`.
 */
export type RecordId = string;

/** Convert a database-native id (`LookupValue`, FK cell value) to an address. */
export function toRecordId(value: string | number): RecordId {
  return String(value);
}
