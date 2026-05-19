import { OperationError, ErrorCode } from "./types.js";
import { isSafeIdentifier } from "../data/sanitize.js";
import { rejectControlChars as coreRejectControlChars } from "../data/sanitize.js";

/**
 * Reject SQL that isn't a SELECT or WITH (CTE) statement.
 * Throws if the query would mutate data.
 */
export function requireSelect(sql: string): void {
  const trimmed = sql.trim().toUpperCase();
  if (!trimmed.startsWith("SELECT") && !trimmed.startsWith("WITH")) {
    throw new OperationError("Only SELECT and WITH (CTE) queries are allowed", ErrorCode.SELECT_ONLY);
  }
}

/**
 * Reject dangerous SQL statements that could destroy data or structure.
 */
export function rejectDangerousSQL(sql: string): void {
  const trimmed = sql.trim().toUpperCase();
  const dangerous = [
    "DROP DATABASE",
    "TRUNCATE",
    "DROP SCHEMA",
  ];

  for (const pattern of dangerous) {
    if (trimmed.includes(pattern)) {
      throw new OperationError(`Dangerous SQL rejected: contains ${pattern}`, ErrorCode.DANGEROUS_SQL);
    }
  }
}

/**
 * Validate that a table name is a safe SQL identifier.
 * Rejects names containing special characters that could enable SQL injection.
 */
export function validateTableName(name: string): void {
  if (!isSafeIdentifier(name)) {
    throw new OperationError(
      `Invalid table name: ${name}`,
      ErrorCode.INVALID_TABLE_NAME,
    );
  }
}

/**
 * Validate that all column names in a list are safe identifiers.
 * Prevents SQL injection via hallucinated column names containing
 * special characters like `;`, `?`, `'`, etc.
 */
export function validateColumnNames(columns: string[]): void {
  for (const col of columns) {
    if (!isSafeIdentifier(col)) {
      throw new OperationError(
        `Invalid column name: ${col}`,
        ErrorCode.INVALID_COLUMN_NAME,
      );
    }
  }
}

/**
 * Reject JSON strings containing control characters.
 * Delegates to core sanitize, wraps in OperationError for error envelope.
 */
export function rejectControlChars(text: string): void {
  try {
    coreRejectControlChars(text);
  } catch {
    throw new OperationError(
      "Input contains control characters",
      ErrorCode.INVALID_JSON,
    );
  }
}
