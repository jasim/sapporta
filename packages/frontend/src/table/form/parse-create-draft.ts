/**
 * Converts a metadata-driven new-record form draft into a create request body.
 *
 * Form controls keep numeric, currency, percentage, date, and timestamp drafts
 * as raw text while the user edits. Raw text can represent an incomplete value
 * such as `-`, or an invalid value that the control must continue to display.
 * Converting on every `onChange` would either lose that text or replace it with
 * `null`.
 *
 * `NewRecordPage` calls `parseCreateDraft()` once in its submit handler. This
 * module reads the shared `TableSchema` metadata and produces public SQL column
 * names with JSON-compatible values:
 *
 * - finite numeric text becomes a number;
 * - date and timestamp text is parsed and canonicalized by the shared Temporal
 *   helpers;
 * - booleans, select values, and lookup values remain canonical because their
 *   controls do not have meaningful intermediate text states;
 * - an empty optional text control remains `""`, while empty non-text controls
 *   are omitted so the backend can apply its normal insert and default rules;
 * - an empty required control and an invalid draft produce a field issue.
 *
 * Parsing is non-mutating. A failed result contains issues separately from the
 * draft, so the form can render field errors while preserving the text the user
 * entered. An empty string is never converted to `null`; required text reports
 * an issue and optional text remains `""` in the request.
 *
 * A successful value can flow through `createTableRow()` to the generated
 * table create endpoint. This parser is an immediate-feedback and
 * request-decoding boundary, not the authoritative validation or authorization
 * boundary. The frontend metadata and editability projection cannot be trusted
 * by the server. Backend API policy rejects fields callers may not set and adds
 * trusted scope values. The scoped-row/save pipeline then performs structural
 * Zod parsing, Temporal canonicalization, and application validation
 * immediately before Drizzle writes the row. Database constraints still apply
 * after that parse. Backend validation failures are returned through the
 * generated API's structured 422 response.
 *
 * This module handles create presence rules only. TGrid patch editors compose
 * the same schema-aware value-draft decoder through their commit-time
 * `valueCodec`, then apply patch empty-value semantics independently. Create
 * and patch are separate compositions because omission means "use a default or
 * optional insert value" during create and "leave this field unchanged" during
 * patch.
 */

import type { TableSchema } from "@sapporta/shared/contracts";
import type { FieldIssue } from "@sapporta/shared/validation";
import { decodeTableValueDraft } from "../model/table-value-draft";
import { isRecordFormEditableColumn } from "./field-policy";

/** @deprecated Use FieldIssue from @sapporta/shared/validation. */
export type CreateDraftIssue = FieldIssue;

export type ParseCreateDraftResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; issues: CreateDraftIssue[] };

/**
 * Decode metadata-driven form drafts once, immediately before submission.
 *
 * A wall clock typed into a `timestamp` field becomes an instant on the zone
 * this page reads on, which is the zone its control was shown in.
 */
export function parseCreateDraft(
  table: TableSchema,
  draft: Readonly<Record<string, unknown>>,
): ParseCreateDraftResult {
  const value: Record<string, unknown> = {};
  const issues: CreateDraftIssue[] = [];

  for (const column of table.columns) {
    if (!isRecordFormEditableColumn(column)) continue;
    const required = column.notNull === true && column.hasDefault !== true;
    const decoded = decodeTableValueDraft(column, draft[column.name]);
    switch (decoded.kind) {
      case "empty":
        if (required) addRequiredIssue(column.name, column.label, issues);
        break;
      case "invalid":
        issues.push({ field: column.name, message: decoded.message });
        break;
      case "value":
        if (required && column.kind === "text" && decoded.value === "") {
          addRequiredIssue(column.name, column.label, issues);
        } else {
          value[column.name] = decoded.value;
        }
        break;
    }
  }

  return issues.length > 0 ? { ok: false, issues } : { ok: true, value };
}

function addRequiredIssue(
  field: string,
  label: string,
  issues: CreateDraftIssue[],
): void {
  issues.push({ field, message: `${label} is required.` });
}
