import { useLayoutEffect } from "react";
import { create } from "zustand";

export type ThemeMode = "light" | "dark";

const STORAGE_KEY = "sapporta:theme";

/** The person's saved choice, or what their system prefers. */
function readPreferredTheme(): ThemeMode {
  if (typeof window === "undefined") return "light";
  const saved = window.localStorage.getItem(STORAGE_KEY);
  if (saved === "light" || saved === "dark") return saved;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

interface ThemeStore {
  /** The mode in effect. */
  mode: ThemeMode;
  /**
   * A mode the app pinned with `forceMode`. While set, `setMode` and `toggle`
   * change nothing, so a light-only app never shows the dark palette however
   * the system is set.
   */
  forcedMode: ThemeMode | null;
  setMode: (mode: ThemeMode) => void;
  toggle: () => void;
  forceMode: (mode: ThemeMode | null) => void;
}

/**
 * Holds the theme mode. Nothing here touches the document: `useDocumentTheme`
 * reflects the mode on `<html data-theme>`, and the standard `AppShell` calls
 * it. An app that renders its own shell calls it too, or leaves it out to stay
 * on the light palette.
 */
export const useThemeStore = create<ThemeStore>((set, get) => ({
  mode: readPreferredTheme(),
  forcedMode: null,
  setMode: (mode) => {
    if (get().forcedMode !== null) return;
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, mode);
    }
    set({ mode });
  },
  toggle: () => {
    const next: ThemeMode = get().mode === "dark" ? "light" : "dark";
    get().setMode(next);
  },
  forceMode: (mode) => {
    set({
      forcedMode: mode,
      mode: mode ?? readPreferredTheme(),
    });
  },
}));

/**
 * Keeps `<html data-theme>` in step with the theme mode while the calling
 * component is mounted, so the `[data-theme="dark"]` palette applies. It runs
 * before the first paint, so a dark-mode visitor never sees a light flash.
 */
export function useDocumentTheme(): void {
  const mode = useThemeStore((s) => s.mode);
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = mode;
  }, [mode]);
}
