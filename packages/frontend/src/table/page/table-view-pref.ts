import { useEffect, useState } from "react";
import type { TGridView } from "./TGrid";

const tableViewModes: readonly TGridView[] = ["auto", "tabular", "cards"];

export function tableViewPreferenceKey(tableName: string): string {
  return `sapporta:table-view:${tableName}`;
}

export function useTableViewPreference(tableName: string): {
  view: TGridView;
  setView: (view: TGridView) => void;
} {
  const key = tableViewPreferenceKey(tableName);
  const [view, setViewState] = useState<TGridView>(() =>
    readTableViewPreference(key),
  );

  useEffect(() => {
    setViewState(readTableViewPreference(key));
  }, [key]);

  return {
    view,
    setView: (nextView) => {
      setViewState(nextView);
      if (typeof window !== "undefined") {
        window.localStorage.setItem(key, nextView);
      }
    },
  };
}

function readTableViewPreference(key: string): TGridView {
  if (typeof window === "undefined") return "auto";
  const value = window.localStorage.getItem(key);
  return normalizeTableViewPreference(value);
}

export function normalizeTableViewPreference(value: string | null): TGridView {
  if (value === "grid") return "tabular";
  if (value === "rows") return "cards";
  return isTGridView(value) ? value : "auto";
}

function isTGridView(value: string | null): value is TGridView {
  return tableViewModes.includes(value as TGridView);
}
