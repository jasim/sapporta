import { create } from "zustand";

export type ThemeMode = "light" | "dark";

const STORAGE_KEY = "sapporta:theme";

function readInitialTheme(): ThemeMode {
  if (typeof window === "undefined") return "light";
  const saved = window.localStorage.getItem(STORAGE_KEY);
  if (saved === "light" || saved === "dark") return saved;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function applyTheme(mode: ThemeMode) {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = mode;
}

interface ThemeStore {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  toggle: () => void;
}

export const useThemeStore = create<ThemeStore>((set, get) => {
  const initial = readInitialTheme();
  applyTheme(initial);

  return {
    mode: initial,
    setMode: (mode) => {
      applyTheme(mode);
      if (typeof window !== "undefined") {
        window.localStorage.setItem(STORAGE_KEY, mode);
      }
      set({ mode });
    },
    toggle: () => {
      const next: ThemeMode = get().mode === "dark" ? "light" : "dark";
      get().setMode(next);
    },
  };
});
