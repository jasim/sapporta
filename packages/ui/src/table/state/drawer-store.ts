import { create } from "zustand";

export interface DrawerState {
  open: boolean;
  mode: "create";
  tableName: string | null;
}

export interface DrawerActions {
  openCreate: (tableName: string) => void;
  close: () => void;
}

export const useDrawerStore = create<DrawerState & DrawerActions>((set) => ({
  open: false,
  mode: "create",
  tableName: null,

  openCreate: (tableName) =>
    set({ open: true, mode: "create", tableName }),

  close: () =>
    set({ open: false, tableName: null }),
}));
