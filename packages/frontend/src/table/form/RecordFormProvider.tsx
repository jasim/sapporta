import { createContext, useContext, type ReactNode, type Context } from "react";
import { useStore } from "zustand";
import type { RecordFormState, RecordFormStore } from "./record-form-store";

const RecordFormContext: Context<RecordFormStore | null> =
  createContext<RecordFormStore | null>(null);

export function RecordFormProvider({
  store,
  children,
}: {
  store: RecordFormStore;
  children: ReactNode;
}) {
  return (
    <RecordFormContext.Provider value={store}>
      {children}
    </RecordFormContext.Provider>
  );
}

export function useRecordFormStore<T>(
  selector: (state: RecordFormState) => T,
): T {
  const store = useContext(RecordFormContext);
  if (!store) {
    throw new Error(
      "useRecordFormStore must be used inside RecordFormProvider",
    );
  }
  return useStore(store, selector);
}

export function useRecordFieldValue(name: string): unknown {
  return useRecordFormStore((state) => state.values[name]);
}

export function useRecordFormSetValue(): RecordFormState["setValue"] {
  return useRecordFormStore((state) => state.setValue);
}
