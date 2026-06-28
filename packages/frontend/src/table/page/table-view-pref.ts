import { useEffect, useState } from "react";

export type TableViewPreference = "auto" | "tabular" | "cards";

const tableViewModes: readonly TableViewPreference[] = [
  "auto",
  "tabular",
  "cards",
];

export function tableViewPreferenceKey(tableName: string): string {
  return `sapporta:table-view:${tableName}`;
}

export function useTableViewPreference(tableName: string): {
  preference: TableViewPreference;
  setPreference: (preference: TableViewPreference) => void;
} {
  const key = tableViewPreferenceKey(tableName);
  const [preference, setPreferenceState] = useState<TableViewPreference>(() =>
    readTableViewPreference(key),
  );

  useEffect(() => {
    setPreferenceState(readTableViewPreference(key));
  }, [key]);

  return {
    preference,
    setPreference: (nextPreference) => {
      setPreferenceState(nextPreference);
      if (typeof window !== "undefined") {
        window.localStorage.setItem(key, nextPreference);
      }
    },
  };
}

function readTableViewPreference(key: string): TableViewPreference {
  if (typeof window === "undefined") return "auto";
  const value = window.localStorage.getItem(key);
  return normalizeTableViewPreference(value);
}

export function normalizeTableViewPreference(
  value: string | null,
): TableViewPreference {
  if (value === "grid") return "tabular";
  if (value === "rows") return "cards";
  return isTableViewPreference(value) ? value : "auto";
}

function isTableViewPreference(
  value: string | null,
): value is TableViewPreference {
  return tableViewModes.includes(value as TableViewPreference);
}
