import { create } from "zustand";
import type { TableSchema } from "@sapporta/shared/contracts";
export interface SchemaState {
  tables: TableSchema[];
  name: string | null;
  slug: string | null;
  loading: boolean;
  loaded: boolean;
  error: string | null;
  activeTable: string | null;
}

export interface SchemaActions {
  setTables: (tables: TableSchema[]) => void;
  setProjectInfo: (info: { name: string; slug: string }) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setActiveTable: (name: string | null) => void;
  reset: () => void;
}

export const useSchemaStore = create<SchemaState & SchemaActions>((set) => ({
  tables: [],
  name: null,
  slug: null,
  loading: false,
  loaded: false,
  error: null,
  activeTable: null,

  setTables: (tables) =>
    set({ tables, loaded: true, loading: false, error: null }),
  setProjectInfo: (info) => set({ name: info.name, slug: info.slug }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error, loading: false }),
  setActiveTable: (name) => set({ activeTable: name }),
  reset: () =>
    set({
      tables: [],
      name: null,
      slug: null,
      loading: false,
      loaded: false,
      error: null,
      activeTable: null,
    }),
}));
