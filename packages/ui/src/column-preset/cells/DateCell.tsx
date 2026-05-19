import type { CellRenderProps } from "../../grid/types/schema";
import type { DatePreset } from "../preset";
import type { ColumnPresetCellRenderRuntime } from "../runtime";

export function DateCell({
  value,
}: Omit<CellRenderProps, "value"> & {
  value: string;
  runtime: ColumnPresetCellRenderRuntime;
  preset: DatePreset;
}) {
  return (
    <span className="mono text-sap-data text-sap-muted truncate">{value}</span>
  );
}
