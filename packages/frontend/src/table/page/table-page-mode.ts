import { useEffect, useRef, useState, type RefObject } from "react";
import type { GridPresentation } from "@sapporta/grid";
import type { TableViewPreference } from "./table-view-pref";

export type TablePageMode = "wide" | "narrowCards";

export const NARROW_TABLE_PAGE_MAX_WIDTH = 760;

export function resolveTablePageMode(width: number): TablePageMode {
  return width < NARROW_TABLE_PAGE_MAX_WIDTH ? "narrowCards" : "wide";
}

export function resolveTableGridPresentation(args: {
  mode: TablePageMode;
  preference: TableViewPreference;
}): GridPresentation {
  if (args.mode === "narrowCards") return "cards";
  return args.preference === "cards" ? "cards" : "tabular";
}

export function useTablePageMode(): {
  ref: RefObject<HTMLDivElement | null>;
  mode: TablePageMode;
} {
  const ref = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<TablePageMode>("wide");

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const update = (width: number) => {
      setMode((current) => {
        const next = resolveTablePageMode(width);
        return current === next ? current : next;
      });
    };

    update(element.getBoundingClientRect().width);

    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      update(entry.contentRect.width);
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return { ref, mode };
}
