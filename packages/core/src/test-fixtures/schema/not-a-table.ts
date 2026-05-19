// This file exports things that are NOT TableDefs.
// loadSchemas should skip them without throwing.

export const someConfig = { host: "localhost", port: 5432 };
export function helper() { return 42; }
export default "not a table";
