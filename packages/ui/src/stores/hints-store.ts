import { useEffect } from "react";
import { create } from "zustand";

export interface KeyHint {
  /** The key glyph (e.g. "⌘K", "↵", "␣", "⇄"). Rendered in brand ink. */
  key: string;
  /** Short verb/description (e.g. "edit", "new row", "command"). */
  desc: string;
}

interface HintsStore {
  hints: KeyHint[];
  setHints: (hints: KeyHint[]) => void;
  clearHints: () => void;
}

/** Status-bar keyboard-hints registry. Routes publish the hints relevant to
 *  their current affordances (e.g. navigate / edit / new row / command /
 *  find / export for a table view); the StatusBar reads them. Empty array
 *  = no hints, bar falls back to the live-status pip only. */
export const useHintsStore = create<HintsStore>((set) => ({
  hints: [],
  setHints: (hints) => set({ hints }),
  clearHints: () => set({ hints: [] }),
}));

/** Publish a route-local set of hints for the lifetime of the component.
 *  The array reference is what useEffect diffs on, so callers typically
 *  pass a stable array (module-level const or useMemo) — otherwise the
 *  hints flicker on every render. */
export function useKeyHints(hints: KeyHint[]): void {
  const setHints = useHintsStore((s) => s.setHints);
  const clearHints = useHintsStore((s) => s.clearHints);
  useEffect(() => {
    setHints(hints);
    return () => clearHints();
  }, [hints, setHints, clearHints]);
}
