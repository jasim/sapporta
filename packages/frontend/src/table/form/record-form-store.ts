import { createStore, type StoreApi } from "zustand/vanilla";
import type { TableSchema } from "@sapporta/shared/contracts";
import { isRecordFormEditableColumn } from "./field-policy";

export type RecordFormValues = Record<string, unknown>;

export interface RecordFormState {
  values: RecordFormValues;
  setValue: (name: string, value: unknown) => void;
  reset: (tableSchema: TableSchema) => void;
}

export type RecordFormStore = StoreApi<RecordFormState>;

export function createRecordFormStore(
  tableSchema: TableSchema,
): RecordFormStore {
  return createStore<RecordFormState>()((set, get) => ({
    values: initialRecordFormValues(tableSchema),
    setValue: (name, value) => {
      const current = get().values[name];
      if (Object.is(current, value)) return;
      set((state) => ({
        values: { ...state.values, [name]: value },
      }));
    },
    reset: (nextTableSchema) => {
      const next = initialRecordFormValues(nextTableSchema);
      if (recordFormValuesEqual(get().values, next)) return;
      set({ values: next });
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

export function compactRecordFormValues(
  values: RecordFormValues,
): RecordFormValues {
  const compacted: RecordFormValues = {};
  for (const [key, value] of Object.entries(values)) {
    if (value !== null && value !== undefined) {
      compacted[key] = value;
    }
  }
  return compacted;
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
