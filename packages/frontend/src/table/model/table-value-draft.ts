/**
 * Schema-aware decoding for values held by table UI controls.
 *
 * A table value draft is not an API value yet. Text-like controls preserve raw
 * input while the user edits, including incomplete values such as `-` and
 * invalid text that must remain visible. This module turns one draft into a
 * typed JSON value, an explicit empty state, or an issue using the server-emitted
 * `ColumnSchema`.
 *
 * The module is the schema-aware table UI seam. Generic editor grammar, such as
 * comma-tolerant numeric text, lives in `@sapporta/grid/column-preset`. Whole
 * create forms add required/default/omission rules in `form/parse-create-draft`.
 * The table-to-grid adapter adds patch commit semantics. These layers share
 * leaf decoding without forcing create forms and cell patches into one shape.
 *
 * Successful values are suitable for a generated table API payload, but this
 * decoder is not an authority boundary. Backend auth enforces writable fields
 * and reference visibility. The save pipeline parses the prepared write again
 * with canonical server Zod schemas immediately before Drizzle.
 */

import { parseNumericInput } from "@sapporta/grid/column-preset";
import { isLookupValue } from "@sapporta/grid/lookup";
import type { ColumnSchema } from "@sapporta/shared/contracts";
import {
  parseDateInputToPlainDateString,
  parseDateTimeLocalInputToCanonicalInstantString,
} from "@sapporta/shared/temporal";

/**
 * A leaf decoder keeps "empty" separate from both a valid value and invalid
 * input so create and patch callers can assign different presence semantics.
 */
export type TableValueDraftDecodeResult =
  | { kind: "value"; value: unknown }
  | { kind: "empty" }
  | { kind: "invalid"; message: string };

export type TablePatchValueDraftParseResult =
  { ok: true; value: unknown } | { ok: false; message: string };

/**
 * Decode one raw table-control value without applying create or patch rules.
 * The function never mutates the draft held by the control.
 */
export function decodeTableValueDraft(
  column: ColumnSchema,
  draft: unknown,
): TableValueDraftDecodeResult {
  if (draft === null || draft === undefined) return { kind: "empty" };

  if (column.select || column.foreignKey) {
    if (draft === "") return { kind: "empty" };
    if (column.foreignKey && !isLookupValue(draft)) {
      return { kind: "invalid", message: "Select a valid value." };
    }
    return { kind: "value", value: draft };
  }

  switch (column.kind) {
    case "number": {
      if (typeof draft === "number") {
        return Number.isFinite(draft)
          ? { kind: "value", value: draft }
          : { kind: "invalid", message: "Enter a finite number." };
      }
      if (typeof draft !== "string") {
        return { kind: "invalid", message: "Enter a finite number." };
      }
      const parsed = parseNumericInput(draft);
      if (!parsed.ok) {
        return { kind: "invalid", message: "Enter a finite number." };
      }
      return parsed.value === null
        ? { kind: "empty" }
        : { kind: "value", value: parsed.value };
    }
    case "date":
      return decodeTemporalDraft(
        draft,
        parseDateInputToPlainDateString,
        "Enter a valid date.",
      );
    case "timestamp":
      return decodeTemporalDraft(
        draft,
        parseDateTimeLocalInputToCanonicalInstantString,
        "Enter a valid date and time.",
      );
    case "boolean":
      return typeof draft === "boolean"
        ? { kind: "value", value: draft }
        : { kind: "invalid", message: "Choose a valid boolean value." };
    case "text":
      return typeof draft === "string"
        ? { kind: "value", value: draft }
        : { kind: "invalid", message: "Enter text." };
  }
}

/**
 * Decode one edited patch value for a generated update body.
 *
 * A grid commit supplies exactly one edited column. Clearing a non-text control
 * is therefore an explicit `null`; columns absent from the surrounding patch
 * object remain unchanged. Text `""` remains a real value. The table-to-grid
 * adapter currently preserves invalid raw text and lets the authoritative
 * backend return the validation error because the generic grid codec contract
 * has no field-issue result.
 */
export function parseTablePatchValueDraft(
  column: ColumnSchema,
  draft: unknown,
): TablePatchValueDraftParseResult {
  const decoded = decodeTableValueDraft(column, draft);
  switch (decoded.kind) {
    case "value":
      return { ok: true, value: decoded.value };
    case "empty":
      return { ok: true, value: null };
    case "invalid":
      return { ok: false, message: decoded.message };
  }
}

function decodeTemporalDraft(
  draft: unknown,
  parse: (value: string) => string | null,
  invalidMessage: string,
): TableValueDraftDecodeResult {
  if (typeof draft !== "string") {
    return { kind: "invalid", message: invalidMessage };
  }
  try {
    const parsed = parse(draft);
    return parsed === null
      ? { kind: "empty" }
      : { kind: "value", value: parsed };
  } catch {
    return { kind: "invalid", message: invalidMessage };
  }
}
