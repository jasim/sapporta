import type { CellRenderProps } from "../../grid/types/schema";
import type { SelectPreset } from "../preset";
import type { ColumnPresetCellRenderRuntime } from "../runtime";

export function SelectCell({
  value,
}: Omit<CellRenderProps, "value"> & {
  value: string;
  runtime: ColumnPresetCellRenderRuntime;
  preset: SelectPreset;
}) {
  return <span>{value}</span>;
}
