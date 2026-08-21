// ---------------------------------------------------------------------------
// Operation result envelope — the contract between domain operations and
// the layers that consume them (API routes, CLI output).
//
// The error codes these envelopes carry are defined in ../errors.ts.
// ---------------------------------------------------------------------------

/**
 * Every operation returns an OperationResult instead of printing directly.
 * This separates data production from presentation, enabling:
 *   - HTTP API responses (meta-api.ts converts to JSON + status codes)
 *   - CLI output formatting (emitResult converts to table or JSON)
 *   - Tests that assert on data, not console output
 */
export type OperationResult = OperationSuccess | OperationFailure;

/**
 * Well-known metadata fields used by the output layer for rendering.
 * These fields are the contract between operation functions and consumers:
 *   - message: displayed before the data table (or as the sole output if tableOutputHandled)
 *   - tableOutputHandled: signals that message/additionalOutput contain the full rendering,
 *     so the output layer should NOT format data[] as a table
 *   - additionalOutput: extra text sections printed after the main table
 *   - errorText: printed to stderr (e.g. warnings from report execution)
 *   - rowCount, dryRun: informational fields for agents consuming JSON output
 *
 * The index signature allows operation-specific extras (e.g. foreignKeys, reportData).
 */
export type OperationMeta = {
  message?: string;
  tableOutputHandled?: boolean;
  additionalOutput?: string;
  errorText?: string;
  rowCount?: number;
  dryRun?: boolean;
  [key: string]: unknown;
};

export type OperationSuccess = {
  ok: true;
  /** Primary result rows. Most operations return a single table of rows. */
  data: Record<string, unknown>[];
  /** Optional metadata (row counts, messages, secondary data like foreign keys). */
  meta?: OperationMeta;
};

export type OperationFailure = {
  ok: false;
  error: string;
  code: string;
};
