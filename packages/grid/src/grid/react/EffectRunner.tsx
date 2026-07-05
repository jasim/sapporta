import { useEffect } from "react";
import { useStore } from "zustand";
import type { GridControllerPublic } from "../interaction/controller";
import type { GridEffect } from "../types/effects";
import { findGridCellElement, findGridRowElement } from "./internal/dom-targets";

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
      container?.focus({ preventScroll: true });
      return;
    }
    case "focusCellEditor": {
      // The editor's own mount effect handles focus & cursor placement;
      // this effect is a no-op marker.
      return;
    }
    case "scrollFocusIntoView": {
      if (!container) return;
      // Scroll effects carry path-local coordinates. The grid root supplies the
      // path scope, and the DOM helper resolves the current cell node only if it
      // is mounted for this paint.
      const cell = findGridCellElement(container, e.coord);
      cell?.scrollIntoView({ block: "nearest", inline: "nearest" });
      return;
    }
    case "scrollRowIntoView": {
      if (!container) return;
      // Boundary navigation can queue a row scroll before the target grid is
      // visible. A missing row is a valid one-shot no-op; the controller keeps
      // logical focus independently of DOM presence.
      const row = findGridRowElement(container, e.rowId);
      row?.scrollIntoView({ block: "nearest", inline: "nearest" });
      return;
    }
  }
}
