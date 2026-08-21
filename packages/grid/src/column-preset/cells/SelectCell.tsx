import type { CellRenderProps } from "../../core/types/schema";
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
    <span className="inline-flex h-[18px] items-center rounded-[4px] bg-sap-chip px-[6px] text-sap-meta font-bold text-sap-soft">
      {value}
    </span>
  );
}
