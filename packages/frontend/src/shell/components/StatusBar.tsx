import { Moon, Sun } from "lucide-react";
import { useThemeStore } from "../state/theme-store";
import { useHintsStore } from "../state/hints-store";
import { SapportaMark } from "./Sidebar";

/**
 * Terminal-style 24px status bar pinned to the bottom of the app. Reads
 * like a TUI status line: framework wordmark → route-supplied keyboard
 * hints → theme toggle. Hints arrive via `useHintsStore` — routes register
 * theirs on mount (see useKeyHints) so each page can advertise its
 * affordances without threading props through the shell.
 */
export function StatusBar() {
  const mode = useThemeStore((s) => s.mode);
  const toggle = useThemeStore((s) => s.toggle);
  const hints = useHintsStore((s) => s.hints);

  return (
    <div className="mono h-sap-bar shrink-0 flex items-center px-3 gap-3 border-t border-sap-border bg-sap-sidebar text-sap-meta text-sap-muted">
      <span className="flex items-center gap-[5px]">
        <SapportaMark size={11} />
        <span>sapporta</span>
      </span>

      {hints.length > 0 && (
        <div className="flex items-center gap-3 min-w-0 overflow-hidden">
          {hints.map((h, i) => (
            <span key={i} className="flex items-center gap-[5px] shrink-0">
              <span className="text-sap-brand">{h.key}</span>
              <span>{h.desc}</span>
            </span>
          ))}
        </div>
      )}

      <div className="flex-1" />
      <button
        type="button"
        onClick={toggle}
        className="flex items-center gap-1 text-sap-subtle hover:text-sap-fg transition-colors cursor-pointer"
        title={`Switch to ${mode === "dark" ? "light" : "dark"} theme`}
      >
        {mode === "dark" ? (
          <Sun className="h-[11px] w-[11px]" />
        ) : (
          <Moon className="h-[11px] w-[11px]" />
        )}
        <span>{mode}</span>
      </button>
    </div>
  );
}
