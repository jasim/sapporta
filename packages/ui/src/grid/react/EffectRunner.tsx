import { useEffect } from "react";
import { useStore } from "zustand";
import type { GridControllerPublic } from "../interaction/controller";
import type { GridEffect } from "../types/effects";

// The single `useEffect` over data in the entire grid (per path).
//
// Subscribes to `controller.effects` (the sibling effect channel) and
// drains it after layout. This is the seam that lets reducers stay pure
// while still producing DOM side effects — focus, scroll, host
// notifications. See `types/effects.ts` for why the queue exists.
//
// The store's array reference only changes when new effects are queued or
// when flushEffects clears them, so this hook is naturally idle across
// no-op transitions (e.g., a selection move that doesn't produce effects
// won't fire this hook).
export function EffectRunner({
  controller,
  containerRef,
}: {
  controller: GridControllerPublic;
  containerRef: React.RefObject<HTMLDivElement | null>;
}) {
  const pending = useStore(controller.effects, (s) => s);

  useEffect(() => {
    if (pending.length === 0) return;
    for (const e of pending) runEffect(e, containerRef.current);
    controller.flushEffects();
  }, [pending, controller, containerRef]);

  return null;
}

function runEffect(e: GridEffect, container: HTMLDivElement | null) {
  switch (e.type) {
    case "focusContainer": {
      container?.focus();
      return;
    }
    case "focusCellEditor": {
      // The editor's own mount effect handles focus & cursor placement;
      // this effect is a no-op marker.
      return;
    }
    case "scrollFocusIntoView": {
      if (!container) return;
      const cell = container.querySelector<HTMLElement>(
        `[data-row-id="${cssEscape(e.coord.rowId)}"] [data-col-id="${cssEscape(e.coord.colId)}"]`,
      );
      cell?.scrollIntoView({ block: "nearest", inline: "nearest" });
      return;
    }
    case "scrollRowIntoView": {
      if (!container) return;
      const row = container.querySelector<HTMLElement>(
        `[data-row-id="${cssEscape(e.rowId)}"]`,
      );
      row?.scrollIntoView({ block: "nearest", inline: "nearest" });
      return;
    }
  }
}

function cssEscape(s: string): string {
  if (typeof window !== "undefined" && (window as Window & { CSS?: { escape?: (s: string) => string } }).CSS?.escape) {
    return (window as Window & { CSS: { escape: (s: string) => string } }).CSS.escape(s);
  }
  return s.replace(/[^\w-]/g, (c) => `\\${c.charCodeAt(0).toString(16)} `);
}
