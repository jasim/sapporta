import { useSyncExternalStore } from "react";
import type { CellRenderProps } from "../../grid/types/schema";
import type { ForeignKeyPreset, LookupPreset } from "../preset";
import type { ColumnPresetCellRenderRuntime } from "../runtime";
import type {
  LookupValue,
  ValueLookup,
} from "../../modules/lookup-cache/value-lookup";

export function LookupValueCell({
  value,
  empty,
  fallbackLabel,
  valueLookup,
}: Omit<CellRenderProps, "value"> & {
  value: LookupValue | null;
  empty: boolean;
  fallbackLabel: string;
  valueLookup: ValueLookup;
  runtime: ColumnPresetCellRenderRuntime;
  preset: ForeignKeyPreset | LookupPreset;
}) {
  const getSnapshot = () =>
    value == null ? "" : (valueLookup.entryForValue(value)?.label ?? "");

  useSyncExternalStore(
    (listener) => valueLookup.subscribeToLookupChanges(listener),
    getSnapshot,
  );

  if (empty) return null;
  if (value == null)
    return <span className="text-sap-muted">{fallbackLabel}</span>;

  const entry = valueLookup.entryForValue(value);
  if (entry) return <span>{entry.label}</span>;

  return <span className="text-sap-muted">{fallbackLabel}</span>;
}
