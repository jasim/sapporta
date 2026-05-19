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
  if (value === "") return null;
  return (
    <span className="inline-flex h-[18px] items-center rounded-[3px] border border-sap-border bg-sap-chip px-[6px] text-sap-menu text-sap-fg">
      {value}
    </span>
  );
}
