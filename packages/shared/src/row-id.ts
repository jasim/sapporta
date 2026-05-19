/** A row's primary-key value as carried over the wire. Always a string at the
 *  UI/JSON boundary; SQLite handles the cast for INTEGER pks via type affinity. */
export type RowId = string;
