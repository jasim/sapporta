import { useSyncExternalStore } from "react";
import type { CellRenderProps } from "../../grid/types/schema";
import type { ForeignKeyPreset, LookupPreset } from "../preset";
import type { ColumnPresetCellRenderRuntime } from "../runtime";
import type { LookupValue, ValueLookup } from "../../lookup";

export function LookupValueCell({
  value,
  empty,
  fallbackLabel,
  preset,
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
  const foreignKey = preset.kind === "foreignKey";
  if (value == null)
    return <span className="text-sap-muted">{fallbackLabel}</span>;

  const entry = valueLookup.entryForValue(value);
  if (entry) {
    return foreignKey ? (
      <span className="mono truncate text-sap-data text-sap-link">
        {entry.label}
      </span>
    ) : (
      <span className="block truncate">{entry.label}</span>
    );
  }

  return foreignKey ? (
    <span className="mono truncate text-sap-data text-sap-subtle">
      {fallbackLabel}
    </span>
  ) : (
    <span className="text-sap-muted">{fallbackLabel}</span>
  );
}
