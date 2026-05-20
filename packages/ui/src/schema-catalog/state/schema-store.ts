import { create } from "zustand";
import type { TableSchema, ReportMeta } from "@sapporta/shared/contracts";
export interface SchemaState {
  tables: TableSchema[];
  reports: ReportMeta[];
  slug: string | null;
  loading: boolean;
  loaded: boolean;
  error: string | null;
  activeTable: string | null;
  activeReport: string | null;
}

export interface SchemaActions {
  setTables: (tables: TableSchema[]) => void;
  setReports: (reports: ReportMeta[]) => void;
  setSlug: (slug: string) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setActiveTable: (name: string | null) => void;
  setActiveReport: (name: string | null) => void;
  reset: () => void;
}

export const useSchemaStore = create<SchemaState & SchemaActions>((set) => ({
  tables: [],
  reports: [],
  slug: null,
  loading: false,
  loaded: false,
  error: null,
  activeTable: null,
  activeReport: null,

  setTables: (tables) => set({ tables, loaded: true, loading: false, error: null }),
  setReports: (reports) => set({ reports }),
  setSlug: (slug) => set({ slug }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error, loading: false }),
  // Mutual exclusion: only one entity type can be "active" at a time.
  // Setting any active* clears the others. This drives sidebar highlighting
  // and ensures the UI knows which kind of content is currently displayed.
  setActiveTable: (name) => set({ activeTable: name, activeReport: null }),
  setActiveReport: (name) => set({ activeReport: name, activeTable: null }),
  reset: () =>
    set({
      tables: [],
      reports: [],
      slug: null,
      loading: false,
      loaded: false,
      error: null,
      activeTable: null,
      activeReport: null,
    }),
}));
