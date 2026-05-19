import { ValidationError } from "../db/errors.js";

/**
 * Reject strings containing control characters (below ASCII 0x20)
 * except for the whitespace characters that JSON legitimately uses:
 * \t (0x09), \n (0x0a), \r (0x0d).
 *
 * AI agents sometimes produce invisible control characters in output.
 * These can cause subtle data corruption when inserted into the database.
 */
export function rejectControlChars(text: string): void {
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text)) {
    throw new ValidationError([
      { field: "", message: "Value contains control characters" },
    ]);
  }
}

/**
 * Check whether a name is a safe SQL identifier:
 * starts with a letter or underscore, followed by alphanumeric or underscores.
 */
export function isSafeIdentifier(name: string): boolean {
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name);
}
