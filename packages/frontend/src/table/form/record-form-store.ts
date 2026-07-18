/**
 * Mutable draft state for metadata-driven record forms.
 *
 * `values` intentionally contains `unknown` rather than API-ready values.
 * Numeric and Temporal controls keep raw strings while the user types so
 * incomplete or invalid input remains visible. `parseCreateDraft()` reads this
 * state once on submit and returns a separate issue collection without
 * rewriting the draft. Editing a field clears only that field's stale issue.
 */

import { createStore, type StoreApi } from "zustand/vanilla";
import type { TableSchema } from "@sapporta/shared/contracts";
import { isRecordFormEditableColumn } from "./field-policy";

export type RecordFormValues = Record<string, unknown>;

export interface RecordFormState {
  values: RecordFormValues;
  issues: Record<string, string>;
  setValue: (name: string, value: unknown) => void;
  setIssues: (issues: readonly { field: string; message: string }[]) => void;
  reset: (tableSchema: TableSchema) => void;
}

export type RecordFormStore = StoreApi<RecordFormState>;

export function createRecordFormStore(
  tableSchema: TableSchema,
): RecordFormStore {
  return createStore<RecordFormState>()((set, get) => ({
    values: initialRecordFormValues(tableSchema),
    issues: {},
    setValue: (name, value) => {
      const current = get().values[name];
      if (Object.is(current, value) && !Object.hasOwn(get().issues, name)) {
        return;
      }
      set((state) => ({
        values: Object.is(current, value)
          ? state.values
          : { ...state.values, [name]: value },
        issues: Object.hasOwn(state.issues, name)
          ? Object.fromEntries(
              Object.entries(state.issues).filter(([field]) => field !== name),
            )
          : state.issues,
      }));
    },
    setIssues: (issues) => {
      set({
        issues: Object.fromEntries(
          issues.map((issue) => [issue.field, issue.message]),
        ),
      });
    },
    reset: (nextTableSchema) => {
      const next = initialRecordFormValues(nextTableSchema);
      if (
        recordFormValuesEqual(get().values, next) &&
        Object.keys(get().issues).length === 0
      ) {
        return;
      }
      set({ values: next, issues: {} });
    },
  }));
}

export function initialRecordFormValues(
  tableSchema: TableSchema,
): RecordFormValues {
  const initial: RecordFormValues = {};
  for (const col of tableSchema.columns) {
    if (!isRecordFormEditableColumn(col)) continue;
    initial[col.name] = null;
  }
  return initial;
}

function recordFormValuesEqual(
  left: RecordFormValues,
  right: RecordFormValues,
): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;

  for (const key of leftKeys) {
    if (!Object.hasOwn(right, key)) return false;
    if (!Object.is(left[key], right[key])) return false;
  }
  return true;
}
