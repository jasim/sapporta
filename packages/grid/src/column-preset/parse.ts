/**
 * Generic commit-time parsers for grid column presets.
 *
 * This package knows editor text grammar, not Sapporta table metadata or API
 * presence rules. Schema-backed table UI composes the reusable numeric grammar
 * through `decodeTableValueDraft()`. The legacy preset parsers continue to
 * return raw invalid text so a grid data source can decide how to report it.
 */

export function parseText(value: string): unknown {
  return value;
}

export type NumericInputParseResult =
  { ok: true; value: number | null } | { ok: false };

/**
 * Decode the text accepted by Sapporta's numeric editors.
 *
 * Commas and surrounding whitespace are editor syntax. Empty text is a
 * successful `null` candidate because the schema-aware caller decides whether
 * clearing means omit, reject, or persist null. Invalid text has no replacement
 * value and remains available to the editor.
 */
export function parseNumericInput(value: string): NumericInputParseResult {
  const trimmed = value.trim();
  if (trimmed === "") return { ok: true, value: null };
  const normalized = trimmed.replace(/,/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? { ok: true, value: parsed } : { ok: false };
}

export function parseNumber(value: string): unknown {
  const result = parseNumericInput(value);
  return result.ok ? result.value : value;
}

export function parseBoolean(value: string): unknown {
  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes", "y", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "n", "off"].includes(normalized)) return false;
  return Boolean(value);
}

export function parseDate(value: string): unknown {
  return value.trim() === "" ? null : value;
}
